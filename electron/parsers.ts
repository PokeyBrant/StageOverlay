import { JSDOM } from 'jsdom'
import crypto from 'node:crypto'
import type { MatchReference, ScrapedMatch, ScrapedShooter, ScrapedStage, ScrapedStageResult, ShooterResolution } from './types'

type ParsedTable = {
  heading: string
  headers: string[]
  rows: string[][]
}

const SCORE_HEADER_HINTS = ['time', 'hit factor', 'hf', 'points', 'penalties', 'penalty', 'percent', '%', 'stage points']
const SHOOTER_HEADER_HINTS = ['name', 'competitor', 'shooter']
const PLACE_HEADER_HINTS = ['place', 'rank', 'finish', 'stage place']

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
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

  const partials = match.shooters.filter((shooter) => normalizeName(shooter.name).includes(normalizedPreferred))
  if (partials.length === 1) {
    return { shooterId: partials[0].id, confidence: 'partial', candidates: partials }
  }

  return { shooterId: null, confidence: 'none', candidates: partials.length > 0 ? partials : match.shooters }
}

export function parseDashboardMatches(html: string): MatchReference[] {
  const dom = new JSDOM(html)
  const document = dom.window.document as Document
  const results = new Map<string, MatchReference>()

  const sections = [
    { headerText: 'Upcoming Events', source: 'dashboard' as const },
    { headerText: 'Recent Events', source: 'recent' as const }
  ]

  for (const section of sections) {
    const headers = Array.from(document.querySelectorAll('h4') as NodeListOf<Element>)
    const header = headers.find((node) =>
      (node.textContent || '').toLowerCase().includes(section.headerText.toLowerCase())
    )
    const panel = header?.closest('.panel') ?? header?.parentElement
    if (!panel) continue

    const rows = panel.querySelectorAll('table tbody tr')
    rows.forEach((row: Element, index: number) => {
      const cells = row.querySelectorAll('td')
      if (cells.length === 0) return
      const link = row.querySelector('a')
      if (!link) return
      const href = link.getAttribute('href') || ''
      const name = (link.textContent || '').trim()
      const date = cells[cells.length - 1]?.textContent?.trim() || null
      const slug = href.split('/').filter(Boolean)[0]
      const url = href.startsWith('http') ? href : `https://practiscore.com/${slug}/register`
      const id = `${section.source}-${slug || index}`

      if (!name) return
      results.set(id, {
        id,
        name,
        date,
        source: section.source,
        url,
        resultsUrl: null
      })
    })
  }

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
  const stages: ScrapedStage[] = []
  const shooterMap = new Map<string, ScrapedShooter>()

  let fallbackStageNumber = 1
  for (const table of tables) {
    if (!isScoreTable(table.headers)) continue

    const shooterIndex = findHeaderIndex(table.headers, SHOOTER_HEADER_HINTS)
    if (shooterIndex === -1) continue

    const placementIndex = findHeaderIndex(table.headers, PLACE_HEADER_HINTS)
    const stageName = inferStageName(table.heading, fallbackStageNumber)
    fallbackStageNumber += 1

    const results = table.rows
      .map((row) => {
        const shooterName = row[shooterIndex]?.trim() || ''
        if (!shooterName) return null

        const stats: Record<string, string> = {}
        table.headers.forEach((header, index) => {
          if (index === shooterIndex || index === placementIndex) return
          const value = row[index]?.trim() || ''
          if (!value) return
          stats[prettifyHeader(header)] = value
        })

        ensureShooter(shooterMap, shooterName)
        return {
          shooterName,
          placement: placementIndex >= 0 ? row[placementIndex]?.trim() || '' : '',
          stats
        } satisfies ScrapedStageResult
      })
      .filter(Boolean) as ScrapedStageResult[]

    if (results.length === 0) continue

    stages.push({
      id: crypto.randomUUID(),
      name: stageName,
      order: stages.length + 1,
      results
    })
  }

  const shooters = Array.from(shooterMap.values())
  return {
    id: crypto.randomUUID(),
    sourceUrl,
    resultsUrl: sourceUrl,
    name: matchName,
    stages,
    shooters
  }
}

function ensureShooter(shooterMap: Map<string, ScrapedShooter>, shooterName: string) {
  const key = normalizeName(shooterName)
  if (shooterMap.has(key)) return
  shooterMap.set(key, {
    id: crypto.randomUUID(),
    name: shooterName
  })
}

function inferStageName(heading: string, fallbackStageNumber: number) {
  const clean = heading.replace(/\s+/g, ' ').trim()
  if (!clean) {
    return `Stage ${fallbackStageNumber}`
  }
  if (/stage/i.test(clean)) {
    return clean
  }
  return `Stage ${fallbackStageNumber}: ${clean}`
}

function collectTables(document: Document): ParsedTable[] {
  return Array.from(document.querySelectorAll('table') as NodeListOf<HTMLTableElement>).map((table) => {
    const headers = Array.from(table.querySelectorAll('thead th, tr th') as NodeListOf<Element>).map((node) => node.textContent?.trim() || '')
    const bodyRows = Array.from(table.querySelectorAll('tbody tr') as NodeListOf<HTMLTableRowElement>)
    const rows = bodyRows.map((row) =>
      Array.from(row.querySelectorAll('td, th')).map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() || '')
    )

    let heading = ''
    let current: Element | null = table
    while (current && !heading) {
      let previous = current.previousElementSibling
      while (previous && !heading) {
        const className = typeof previous.className === 'string' ? previous.className : ''
        if (/^H[1-6]$/.test(previous.tagName) || className.toLowerCase().includes('stage')) {
          heading = previous.textContent?.trim() || ''
        }
        previous = previous.previousElementSibling
      }
      current = current.parentElement
    }

    return { heading, headers, rows }
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
