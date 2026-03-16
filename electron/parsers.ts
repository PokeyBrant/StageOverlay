import { JSDOM } from 'jsdom'
import crypto from 'node:crypto'
import type { MatchReference, ScrapedMatch, ScrapedMatchResult, ScrapedShooter, ScrapedStage, ScrapedStageResult, ShooterResolution } from './types'

type ParsedTable = {
  headings: string[]
  headers: string[]
  rows: string[][]
}

const SCORE_HEADER_HINTS = ['time', 'hit factor', 'hf', 'points', 'penalties', 'penalty', 'percent', '%', 'stage points']
const SHOOTER_HEADER_HINTS = ['name', 'competitor', 'shooter']
const PLACE_HEADER_HINTS = ['place', 'rank', 'finish', 'stage place']
const DIVISION_HEADER_HINTS = ['division', 'div']
const CLASS_HEADER_HINTS = ['class']
const POWER_FACTOR_HEADER_HINTS = ['power factor', 'powerfactor', 'pf']

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function cleanShooterName(value: string) {
  return value
    .replace(/^\s*\d+\s*[-.)]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function resolveShooter(match: ScrapedMatch, preferredName: string): ShooterResolution {
  const normalizedPreferred = normalizeName(preferredName)
  if (!normalizedPreferred) {
    return { shooterId: null, confidence: 'none', candidates: match.shooters }
  }

  const exact = match.shooters.find((shooter) => normalizeName(shooter.name) === normalizedPreferred)
  if (exact) {
    return { shooterId: exact.id, confidence: 'exact', candidates: [exact] }
  }

  const preferredTokens = tokenizeName(preferredName)
  const reorderedExactMatches = match.shooters.filter((shooter) => sameNameParts(shooter.name, preferredName))
  if (reorderedExactMatches.length === 1) {
    return { shooterId: reorderedExactMatches[0].id, confidence: 'exact', candidates: reorderedExactMatches }
  }
  if (reorderedExactMatches.length > 1) {
    return { shooterId: null, confidence: 'none', candidates: reorderedExactMatches }
  }

  const partials = match.shooters.filter((shooter) => matchesNameParts(shooter.name, preferredTokens) || normalizeName(shooter.name).includes(normalizedPreferred))
  if (partials.length === 1) {
    return { shooterId: partials[0].id, confidence: 'partial', candidates: partials }
  }

  return { shooterId: null, confidence: 'none', candidates: partials.length > 0 ? partials : match.shooters }
}

export function parseDashboardMatches(html: string): MatchReference[] {
  const dom = new JSDOM(html)
  const document = dom.window.document as Document
  const results = new Map<string, MatchReference>()

  const headers = Array.from(document.querySelectorAll('h4') as NodeListOf<Element>)
  const header = headers.find((node) =>
    (node.textContent || '').toLowerCase().includes('recent events')
  )
  const panel = header?.closest('.panel') ?? header?.parentElement
  if (!panel) return []

  const rows = panel.querySelectorAll('table tbody tr')
  rows.forEach((row: Element, index: number) => {
    const cells = row.querySelectorAll('td')
    if (cells.length === 0) return

    const anchors = Array.from(row.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>)
    const primaryLink = anchors.find((link) => Boolean((link.textContent || '').trim())) ?? anchors[0]
    if (!primaryLink) return

    const resultsLink = anchors.find((link) => /\/results(?:\/new)?\//i.test(link.href))
    const href = primaryLink.getAttribute('href') || ''
    const name = (primaryLink.textContent || '').trim()
    const date = cells[cells.length - 1]?.textContent?.trim() || null
    const absoluteUrl = toAbsolutePractiScoreUrl(href)
    const resultsUrl = resultsLink ? toAbsolutePractiScoreUrl(resultsLink.getAttribute('href') || resultsLink.href) : inferResultsUrl(absoluteUrl)
    const pathSegments = new URL(absoluteUrl).pathname.split('/').filter(Boolean)
    const slug = pathSegments[pathSegments.length - 1] || `${index}`
    const id = `recent-${slug || index}`

    if (!name) return
    results.set(id, {
      id,
      name,
      date,
      source: 'recent',
      url: absoluteUrl,
      resultsUrl
    })
  })

  return Array.from(results.values())
}

export function parseResultsHtml(html: string, sourceUrl: string): ScrapedMatch {
  const dom = new JSDOM(html)
  const document = dom.window.document as Document
  const matchName =
    document.querySelector('h1')?.textContent?.trim() ||
    document.querySelector('h2')?.textContent?.trim() ||
    document.title.replace(/\s*-\s*practiscore\.com/i, '').trim() ||
    'PractiScore Match'

  const tables = collectTables(document)
  const matchResults: ScrapedMatchResult[] = []
  const stages: ScrapedStage[] = []
  const shooterMap = new Map<string, ScrapedShooter>()
  const matchResultsByShooter = new Map<string, ScrapedMatchResult>()
  const summaryDivisionTables: Array<{ divisionName: string; headers: string[]; rows: string[][] }> = []
  const stageMap = new Map<string, { stage: ScrapedStage; resultsByShooter: Map<string, ScrapedStageResult> }>()
  const divisionTables: Array<{ stageKey: string; divisionName: string; headers: string[]; rows: string[][] }> = []

  let fallbackStageNumber = 1
  for (const table of tables) {
    if (!isScoreTable(table.headers)) continue

    const shooterIndex = findHeaderIndex(table.headers, SHOOTER_HEADER_HINTS)
    if (shooterIndex === -1) continue

    const explicitStageName = findStageHeading(table.headings)
    const divisionIndex = findHeaderIndex(table.headers, DIVISION_HEADER_HINTS)
    const divisionName = inferDivisionName(table.headings, explicitStageName)
    const isDivisionSpecific = divisionIndex === -1 && Boolean(divisionName)

    if (!explicitStageName) {
      if (isDivisionSpecific && divisionName) {
        summaryDivisionTables.push({
          divisionName,
          headers: table.headers,
          rows: table.rows
        })
        continue
      }

      const summaryResults = parseRows(table.headers, table.rows, shooterIndex, divisionIndex)
      for (const result of summaryResults) {
        ensureShooter(shooterMap, result.shooterName, result.division ?? null)
        matchResults.push(result)
        matchResultsByShooter.set(normalizeName(result.shooterName), result)
      }
      continue
    }

    const stageName = inferStageName(table.headings, fallbackStageNumber)
    const stageKey = normalizeName(stageName)
    if (!stageMap.has(stageKey)) {
      stageMap.set(stageKey, {
        stage: {
          id: crypto.randomUUID(),
          name: stageName,
          order: stages.length + 1,
          results: []
        },
        resultsByShooter: new Map<string, ScrapedStageResult>()
      })
      stages.push(stageMap.get(stageKey)!.stage)
      fallbackStageNumber += 1
    }

    const stageEntry = stageMap.get(stageKey)!

    if (isDivisionSpecific && divisionName) {
      divisionTables.push({
        stageKey,
        divisionName,
        headers: table.headers,
        rows: table.rows
      })
      continue
    }

    const stageResults = parseRows(table.headers, table.rows, shooterIndex, divisionIndex)
    for (const result of stageResults) {
      ensureShooter(shooterMap, result.shooterName, result.division ?? null)
      stageEntry.stage.results.push(result)
      stageEntry.resultsByShooter.set(normalizeName(result.shooterName), result)
    }
  }

  for (const divisionTable of summaryDivisionTables) {
    applyDivisionRows(matchResultsByShooter, divisionTable.headers, divisionTable.rows, divisionTable.divisionName, shooterMap)
  }

  for (const divisionTable of divisionTables) {
    const stageEntry = stageMap.get(divisionTable.stageKey)
    if (!stageEntry) continue

    applyDivisionRows(stageEntry.resultsByShooter, divisionTable.headers, divisionTable.rows, divisionTable.divisionName, shooterMap)
  }

  const shooters = Array.from(shooterMap.values())
  return {
    id: crypto.randomUUID(),
    sourceUrl,
    resultsUrl: sourceUrl,
    name: matchName,
    matchResults,
    stages,
    shooters
  }
}

export function parseResultsTable(headers: string[], rows: string[][]): ScrapedStageResult[] {
  if (!isScoreTable(headers)) return []

  const shooterIndex = findHeaderIndex(headers, SHOOTER_HEADER_HINTS)
  if (shooterIndex === -1) return []

  const divisionIndex = findHeaderIndex(headers, DIVISION_HEADER_HINTS)
  return parseRows(headers, rows, shooterIndex, divisionIndex)
}

export function findShooterResult(results: ScrapedStageResult[], preferredName: string, shooterName?: string | null): ScrapedStageResult | null {
  const normalizedShooterName = shooterName ? normalizeName(cleanShooterName(shooterName)) : null
  if (normalizedShooterName) {
    return results.find((result) => normalizeName(result.shooterName) === normalizedShooterName) ?? null
  }

  const normalizedPreferred = normalizeName(preferredName)
  if (!normalizedPreferred) {
    return null
  }

  const exact = results.find((result) => normalizeName(result.shooterName) === normalizedPreferred)
  if (exact) {
    return exact
  }

  const reorderedExactMatches = results.filter((result) => sameNameParts(result.shooterName, preferredName))
  if (reorderedExactMatches.length === 1) {
    return reorderedExactMatches[0]
  }

  const preferredTokens = tokenizeName(preferredName)
  const partialMatches = results.filter((result) =>
    matchesNameParts(result.shooterName, preferredTokens) || normalizeName(result.shooterName).includes(normalizedPreferred)
  )
  if (partialMatches.length === 1) {
    return partialMatches[0]
  }

  return null
}

function ensureShooter(shooterMap: Map<string, ScrapedShooter>, shooterName: string, division: string | null = null) {
  const cleanName = cleanShooterName(shooterName)
  const key = normalizeName(cleanName)
  const existing = shooterMap.get(key)
  if (existing) {
    if (division && !existing.division) {
      existing.division = division
    }
    return
  }
  shooterMap.set(key, {
    id: crypto.randomUUID(),
    name: cleanName,
    division
  })
}

function inferStageName(headings: string[], fallbackStageNumber: number) {
  const explicitStageName = findStageHeading(headings)
  if (explicitStageName) return explicitStageName

  const fallbackHeading = headings
    .map((heading) => heading.replace(/\s+/g, ' ').trim())
    .find((heading) => heading && !/results?/i.test(heading))

  if (fallbackHeading) {
    return `Stage ${fallbackStageNumber}: ${fallbackHeading}`
  }

  return `Stage ${fallbackStageNumber}`
}

function findStageHeading(headings: string[]) {
  for (const heading of [...headings].reverse()) {
    const clean = heading.replace(/\s+/g, ' ').trim()
    if (!clean) continue
    if (/stage/i.test(clean)) {
      return clean
    }
  }
  return null
}

function inferDivisionName(headings: string[], stageName: string | null) {
  const normalizedStage = stageName ? normalizeName(stageName) : null
  for (const heading of [...headings].reverse()) {
    const clean = heading.replace(/\s+/g, ' ').trim()
    if (!clean || (normalizedStage && normalizeName(clean) === normalizedStage)) continue

    const labeledMatch = clean.match(/(?:division|div)\s*[:\-]\s*(.+)$/i)
    if (labeledMatch?.[1]) {
      return labeledMatch[1].trim()
    }

    if (/overall/i.test(clean) || /results?/i.test(clean) || /stage/i.test(clean)) {
      continue
    }

    return clean
  }

  return null
}

function collectTables(document: Document): ParsedTable[] {
  return Array.from(document.querySelectorAll('table') as NodeListOf<HTMLTableElement>).map((table) => {
    const headers = Array.from(table.querySelectorAll('thead th, tr th') as NodeListOf<Element>).map((node) => node.textContent?.trim() || '')
    const bodyRows = Array.from(table.querySelectorAll('tbody tr') as NodeListOf<HTMLTableRowElement>)
    const rows = bodyRows.map((row) =>
      Array.from(row.querySelectorAll('td, th')).map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() || '')
    )

    const headings = getTableHeadings(table)

    return { headings, headers, rows }
  })
}

function isScoreTable(headers: string[]) {
  const normalized = headers.map((header) => header.toLowerCase())
  const hasShooter = normalized.some((header) => SHOOTER_HEADER_HINTS.some((hint) => header.includes(hint)))
  const hasMetrics = normalized.some((header) => SCORE_HEADER_HINTS.some((hint) => header.includes(hint)))
  return hasShooter && hasMetrics
}

function findHeaderIndex(headers: string[], hints: string[]) {
  return headers.findIndex((header) => hints.some((hint) => header.toLowerCase().includes(hint)))
}

function prettifyHeader(header: string) {
  return header
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function toAbsolutePractiScoreUrl(href: string) {
  if (href.startsWith('http')) {
    return href
  }
  return new URL(href, 'https://practiscore.com').toString()
}

function inferResultsUrl(url: string) {
  if (/\/results(?:\/new)?\//i.test(url)) {
    return url
  }
  return null
}

export function tokenizeName(value: string) {
  return normalizeName(cleanShooterName(value))
    .split(' ')
    .filter(Boolean)
}

function sameNameParts(left: string, right: string) {
  const leftTokens = tokenizeName(left).sort()
  const rightTokens = tokenizeName(right).sort()
  return leftTokens.length > 0 && leftTokens.length === rightTokens.length && leftTokens.every((token, index) => token === rightTokens[index])
}

export function matchesNameParts(candidateName: string, preferredTokens: string[]) {
  if (preferredTokens.length === 0) return false
  const candidateTokens = tokenizeName(candidateName)
  return preferredTokens.every((preferredToken) => candidateTokens.some((candidateToken) => candidateToken.includes(preferredToken)))
}

function getTableHeadings(table: HTMLTableElement) {
  const headings: string[] = []
  let current: Element | null = table

  while (current) {
    let previous = current.previousElementSibling
    while (previous) {
      const text = previous.textContent?.replace(/\s+/g, ' ').trim() || ''
      const className = typeof previous.className === 'string' ? previous.className.toLowerCase() : ''
      const isHeading = /^H[1-6]$/.test(previous.tagName) || className.includes('stage') || className.includes('division')

      if (isHeading && text && !headings.includes(text)) {
        headings.unshift(text)
        if (/stage/i.test(text)) {
          return headings
        }
      }

      previous = previous.previousElementSibling
    }
    current = current.parentElement
  }

  return headings
}

function parseRows(headers: string[], rows: string[][], shooterIndex: number, divisionIndex: number) {
  const placementIndex = findHeaderIndex(headers, PLACE_HEADER_HINTS)
  const classIndex = findHeaderIndex(headers, CLASS_HEADER_HINTS)
  const powerFactorIndex = findHeaderIndex(headers, POWER_FACTOR_HEADER_HINTS)

  return rows
    .map((row) => {
      const shooterName = cleanShooterName(row[shooterIndex]?.trim() || '')
      if (!shooterName) return null

      const division = divisionIndex >= 0 ? row[divisionIndex]?.trim() || null : null
      const className = classIndex >= 0 ? row[classIndex]?.trim() || undefined : undefined
      const powerFactor = powerFactorIndex >= 0 ? row[powerFactorIndex]?.trim() || undefined : undefined
      const stats: Record<string, string> = {}

      headers.forEach((header, index) => {
        if ([shooterIndex, placementIndex, divisionIndex, classIndex, powerFactorIndex].includes(index)) return
        const value = row[index]?.trim() || ''
        if (!value) return
        stats[prettifyHeader(header)] = value
      })

      return {
        shooterName,
        overallPlacement: placementIndex >= 0 ? row[placementIndex]?.trim() || undefined : undefined,
        divisionPlacement: null,
        division,
        className,
        powerFactor,
        stats,
        divisionStats: null
      } satisfies ScrapedStageResult
    })
    .filter(Boolean) as ScrapedStageResult[]
}

function applyDivisionRows(
  resultsByShooter: Map<string, ScrapedStageResult | ScrapedMatchResult>,
  headers: string[],
  rows: string[][],
  divisionName: string,
  shooterMap: Map<string, ScrapedShooter>
) {
  const shooterIndex = findHeaderIndex(headers, SHOOTER_HEADER_HINTS)
  if (shooterIndex === -1) return

  const placementIndex = findHeaderIndex(headers, PLACE_HEADER_HINTS)
  const classIndex = findHeaderIndex(headers, CLASS_HEADER_HINTS)
  const powerFactorIndex = findHeaderIndex(headers, POWER_FACTOR_HEADER_HINTS)

  for (const row of rows) {
    const shooterName = cleanShooterName(row[shooterIndex]?.trim() || '')
    if (!shooterName) continue

    const result = resultsByShooter.get(normalizeName(shooterName))
    if (!result) continue

    if (result.division && normalizeName(result.division) !== normalizeName(divisionName)) {
      continue
    }

    const divisionStats: Record<string, string> = {}
    headers.forEach((header, index) => {
      if ([shooterIndex, placementIndex, classIndex, powerFactorIndex].includes(index)) return
      const value = row[index]?.trim() || ''
      if (!value) return
      divisionStats[prettifyHeader(header)] = value
    })

    result.division = result.division ?? divisionName
    result.divisionPlacement = placementIndex >= 0 ? row[placementIndex]?.trim() || null : null
    result.className = result.className ?? (classIndex >= 0 ? row[classIndex]?.trim() || undefined : undefined)
    result.powerFactor = result.powerFactor ?? (powerFactorIndex >= 0 ? row[powerFactorIndex]?.trim() || undefined : undefined)
    result.divisionStats = Object.keys(divisionStats).length > 0 ? divisionStats : result.divisionStats ?? null
    ensureShooter(shooterMap, shooterName, result.division)
  }
}
