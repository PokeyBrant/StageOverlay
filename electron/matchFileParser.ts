import { JSDOM } from 'jsdom'
import crypto from 'node:crypto'
import type { ParsedMatch, ParsedMatchResult, ParsedShooter, ParsedStage, ParsedStageResult, ShooterResolution } from './types.ts'

type ParsedTable = {
  headings: string[]
  headers: string[]
  rows: string[][]
}

type ReportMatchInfo = {
  name: string
  rawDate: string | null
}

type ReportCompetitor = {
  sourceEntryId: number
  shooterName: string
  memberNumber: string | null
  className: string | undefined
  division: string | null
  powerFactor: string | undefined
  matchPoints: number
  matchPointsText: string
  overallPlacement: string | undefined
}

type ReportStageScore = {
  shooterKey: string
  shooterName: string
  division: string | null
  className: string | undefined
  powerFactor: string | undefined
  overallPlacement: string | undefined
  overallPlacementValue: number | null
  hitFactor: number
  time: number
  timeText: string
  points: number
  pointsText: string
  stagePoints: number
  stagePointsText: string
  counts: Record<string, string>
}

type ReportStage = {
  sourceStageId: number
  stage: ParsedStage
  maxPoints: number
  scoreMap: Map<string, ReportStageScore>
}

const REPORT_RANK_TOLERANCE = 0.00005

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

function parseShooterCell(value: string) {
  const raw = value.trim()
  const embeddedPlacement = raw.match(/^\s*(\d+)\s*[-.)]\s*/)?.[1] ?? null
  return {
    shooterName: cleanShooterName(raw),
    embeddedPlacement
  }
}

export function cleanMatchTitle(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .trim()
}

export function resolveShooter(match: ParsedMatch, preferredName: string): ShooterResolution {
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

export function parseResultsHtml(html: string, sourceUrl: string): ParsedMatch {
  const dom = new JSDOM(html)
  const document = dom.window.document as Document
  const matchName = cleanMatchTitle(
    document.querySelector('h1')?.textContent?.trim() ||
    document.querySelector('h2')?.textContent?.trim() ||
    document.title.trim() ||
    'Imported Match'
  )

  const tables = collectTables(document)
  const matchResults: ParsedMatchResult[] = []
  const stages: ParsedStage[] = []
  const shooterMap = new Map<string, ParsedShooter>()
  const matchResultsByShooter = new Map<string, ParsedMatchResult>()
  const summaryDivisionTables: Array<{ divisionName: string; headers: string[]; rows: string[][] }> = []
  const stageMap = new Map<string, { stage: ParsedStage; resultsByShooter: Map<string, ParsedStageResult> }>()
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
        resultsByShooter: new Map<string, ParsedStageResult>()
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

  return {
    id: crypto.randomUUID(),
    sourceUrl,
    resultsUrl: sourceUrl,
    name: matchName,
    matchResults,
    stages,
    shooters: Array.from(shooterMap.values())
  }
}

export function parseResultsReport(reportText: string, sourceUrl: string): ParsedMatch {
  const normalizedReport = reportText.replace(/\r\n?/g, '\n')
  const lines = normalizedReport
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const infoLines = lines.filter((line) => line.startsWith('$INFO '))
  const competitorLines = lines.filter((line) => line.startsWith('E '))
  const stageLines = lines.filter((line) => line.startsWith('G '))
  const stageScoreLines = lines.filter((line) => line.startsWith('I '))

  const info = parseReportInfo(infoLines)
  const competitors = parseReportCompetitors(competitorLines)
  const stages = parseReportStages(stageLines)
  const matchResultsByShooter = new Map<string, ParsedMatchResult>()
  const matchResultMetaByShooter = new Map<string, { matchPoints: number; division: string | null }>()
  const shooterMap = new Map<string, ParsedShooter>()

  for (const competitor of Array.from(competitors.values())) {
    const shooterKey = normalizeName(competitor.shooterName)
    const existingMeta = matchResultMetaByShooter.get(shooterKey)
    if (!existingMeta || competitor.matchPoints > existingMeta.matchPoints) {
      matchResultMetaByShooter.set(shooterKey, {
        matchPoints: competitor.matchPoints,
        division: competitor.division
      })
      matchResultsByShooter.set(shooterKey, {
        shooterName: competitor.shooterName,
        overallPlacement: competitor.overallPlacement,
        divisionPlacement: null,
        division: competitor.division ?? null,
        className: competitor.className,
        powerFactor: competitor.powerFactor,
        stats: {
          'Match Points': competitor.matchPointsText
        },
        divisionStats: null
      })
    }

    ensureShooter(shooterMap, competitor.shooterName, competitor.division ?? null)
  }

  parseReportStageScores(stageScoreLines, competitors, stages, shooterMap)

  const stageDivisionPointTotals = new Map<string, number>()

  for (const stageEntry of Array.from(stages.values())) {
    const stageScores = Array.from(stageEntry.scoreMap.values())
    const sortedOverall = [...stageScores].sort((left, right) => compareReportStageScores(left, right))
    const stageResultsByShooter = new Map<string, ParsedStageResult>()
    sortedOverall.forEach((score) => {
      const result = toParsedStageResult(score, stageEntry.maxPoints)
      stageEntry.stage.results.push(result)
      stageResultsByShooter.set(score.shooterKey, result)
    })
    assignDensePlacements(
      sortedOverall,
      (score) => score.stagePoints,
      (score, placement) => {
        const result = stageResultsByShooter.get(score.shooterKey)
        if (result) {
          result.overallPlacement = placement
        }
      }
    )

    const divisionGroups = new Map<string, ReportStageScore[]>()
    for (const score of stageScores) {
      const divisionKey = normalizeName(score.division ?? '')
      if (!divisionGroups.has(divisionKey)) {
        divisionGroups.set(divisionKey, [])
      }
      divisionGroups.get(divisionKey)!.push(score)
    }

    for (const divisionScores of Array.from(divisionGroups.values())) {
      const divisionWinnerHitFactor = Math.max(...divisionScores.map((score) => score.hitFactor), 0)
      const sortedDivision = [...divisionScores].sort((left, right) => compareReportStageScores(left, right))
      assignDensePlacements(
        sortedDivision,
        (score) => score.stagePoints,
        (score, placement) => {
          const result = stageEntry.stage.results.find((candidate) => normalizeName(candidate.shooterName) === score.shooterKey)
          if (!result) {
            return
          }

          const divisionStagePoints = divisionWinnerHitFactor > 0
            ? (stageEntry.maxPoints * score.hitFactor) / divisionWinnerHitFactor
            : score.stagePoints
          result.divisionPlacement = placement
          result.divisionStats = {
            ...result.stats,
            '%': formatPercent(stageEntry.maxPoints > 0 ? (divisionStagePoints / stageEntry.maxPoints) * 100 : 0),
            'Stg Pts': formatNumber(divisionStagePoints, 4)
          }

          const aggregateKey = `${score.shooterKey}::${normalizeName(score.division ?? '')}`
          stageDivisionPointTotals.set(aggregateKey, (stageDivisionPointTotals.get(aggregateKey) ?? 0) + divisionStagePoints)
        }
      )
    }
  }

  const overallWinnerMatchPoints = Math.max(...Array.from(matchResultMetaByShooter.values()).map((entry) => entry.matchPoints), 0)
  for (const [shooterKey, result] of Array.from(matchResultsByShooter.entries())) {
    const overallMatchPoints = matchResultMetaByShooter.get(shooterKey)?.matchPoints ?? 0
    result.stats['%'] = formatPercent(overallWinnerMatchPoints > 0 ? (overallMatchPoints / overallWinnerMatchPoints) * 100 : 0)
  }

  const divisionGroups = new Map<string, Array<{ shooterKey: string; result: ParsedMatchResult; rankingPoints: number }>>()
  for (const [shooterKey, result] of Array.from(matchResultsByShooter.entries())) {
    const divisionKey = normalizeName(result.division ?? '')
    const aggregateKey = `${shooterKey}::${divisionKey}`
    const rankingPoints = stageDivisionPointTotals.get(aggregateKey) ?? (Number.parseFloat(result.stats['Match Points'] ?? '0') || 0)
    if (!divisionGroups.has(divisionKey)) {
      divisionGroups.set(divisionKey, [])
    }
    divisionGroups.get(divisionKey)!.push({ shooterKey, result, rankingPoints })
  }

  for (const group of Array.from(divisionGroups.values())) {
    group.sort((left, right) => compareDivisionMatchResults(left.result, left.rankingPoints, right.result, right.rankingPoints))
    const divisionWinnerPoints = Math.max(...group.map((entry) => entry.rankingPoints), 0)
    assignDensePlacements(
      group,
      (entry) => entry.rankingPoints,
      (entry, placement) => {
        entry.result.divisionPlacement = placement
        entry.result.divisionStats = {
          '%': formatPercent(divisionWinnerPoints > 0 ? (entry.rankingPoints / divisionWinnerPoints) * 100 : 0),
          'Match Points': formatNumber(entry.rankingPoints, 4)
        }
      }
    )
  }

  return {
    id: crypto.randomUUID(),
    sourceUrl,
    resultsUrl: sourceUrl,
    name: cleanMatchTitle(info.name || 'Imported Match'),
    date: info.rawDate,
    matchResults: Array.from(matchResultsByShooter.values()),
    stages: Array.from(stages.values()).sort((left, right) => left.stage.order - right.stage.order).map((entry) => entry.stage),
    shooters: Array.from(shooterMap.values())
  }
}

export function parseResultsTable(headers: string[], rows: string[][]): ParsedStageResult[] {
  if (!isScoreTable(headers)) return []

  const shooterIndex = findHeaderIndex(headers, SHOOTER_HEADER_HINTS)
  if (shooterIndex === -1) return []

  const divisionIndex = findHeaderIndex(headers, DIVISION_HEADER_HINTS)
  return parseRows(headers, rows, shooterIndex, divisionIndex)
}

export function findShooterResult(results: ParsedStageResult[], preferredName: string, shooterName?: string | null): ParsedStageResult | null {
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

function ensureShooter(shooterMap: Map<string, ParsedShooter>, shooterName: string, division: string | null = null) {
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

function parseReportInfo(infoLines: string[]): ReportMatchInfo {
  const info: ReportMatchInfo = {
    name: '',
    rawDate: null
  }

  for (const line of infoLines) {
    if (line.startsWith('$INFO Match name:')) {
      info.name = line.replace('$INFO Match name:', '').trim()
      continue
    }

    if (line.startsWith('$INFO Match date:')) {
      info.rawDate = line.replace('$INFO Match date:', '').trim()
    }
  }

  return info
}

function parseReportCompetitors(lines: string[]) {
  const competitors = new Map<number, ReportCompetitor>()

  for (const line of lines) {
    const parts = parseCsvLine(line.slice(2))
    const sourceEntryId = parseInteger(getReportField(parts, 0))
    if (!sourceEntryId) {
      continue
    }

    const shooterName = [getReportField(parts, 2), getReportField(parts, 3)]
      .map((value) => value.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (!shooterName) {
      continue
    }

    const matchPoints = parseNumber(getReportField(parts, 10))
    competitors.set(sourceEntryId, {
      sourceEntryId,
      shooterName,
      memberNumber: getReportField(parts, 1) || null,
      className: getReportField(parts, 8) || undefined,
      division: getReportField(parts, 9) || null,
      powerFactor: getReportField(parts, 12) || undefined,
      matchPoints,
      matchPointsText: formatNumber(matchPoints, 4),
      overallPlacement: getReportField(parts, 11) || undefined
    })
  }

  return competitors
}

function parseReportStages(lines: string[]) {
  const stages = new Map<number, ReportStage>()

  for (const line of lines) {
    const parts = parseCsvLine(line.slice(2))
    const sourceStageId = parseInteger(getReportField(parts, 0))
    if (!sourceStageId) {
      continue
    }

    const maxPoints = parseNumber(getReportField(parts, 3))
    const stageName = getReportField(parts, 6) || `Stage ${stages.size + 1}`
    stages.set(sourceStageId, {
      sourceStageId,
      maxPoints,
      stage: {
        id: crypto.randomUUID(),
        name: stageName,
        order: stages.size + 1,
        results: []
      },
      scoreMap: new Map<string, ReportStageScore>()
    })
  }

  return stages
}

function parseReportStageScores(
  lines: string[],
  competitors: Map<number, ReportCompetitor>,
  stages: Map<number, ReportStage>,
  shooterMap: Map<string, ParsedShooter>
) {
  for (const line of lines) {
    const parts = parseCsvLine(line.slice(2))
    const sourceStageId = parseInteger(getReportField(parts, 1))
    const sourceEntryId = parseInteger(getReportField(parts, 2))
    if (!sourceStageId || !sourceEntryId) {
      continue
    }

    const stageEntry = stages.get(sourceStageId)
    const competitor = competitors.get(sourceEntryId)
    if (!stageEntry || !competitor) {
      continue
    }

    const shooterKey = normalizeName(competitor.shooterName)
    const score: ReportStageScore = {
      shooterKey,
      shooterName: competitor.shooterName,
      division: competitor.division,
      className: competitor.className,
      powerFactor: competitor.powerFactor,
      overallPlacement: getReportField(parts, 30) || undefined,
      overallPlacementValue: parseInteger(getReportField(parts, 30)),
      hitFactor: parseNumber(getReportField(parts, 28)),
      time: parseNumber(normalizeReportTime(getReportField(parts, 25))),
      timeText: formatNumber(parseNumber(normalizeReportTime(getReportField(parts, 25))), 2),
      points: parseNumber(getReportField(parts, 27)),
      pointsText: formatNumber(parseNumber(getReportField(parts, 27)), 0),
      stagePoints: parseNumber(getReportField(parts, 29)),
      stagePointsText: formatNumber(parseNumber(getReportField(parts, 29)), 4),
      counts: {
        A: formatCount(getReportField(parts, 5)),
        B: formatCount(getReportField(parts, 6)),
        C: formatCount(getReportField(parts, 7)),
        D: formatCount(getReportField(parts, 8)),
        M: formatCount(getReportField(parts, 9)),
        NS: formatCount(getReportField(parts, 10)),
        PROC: formatCount(sumReportCounts(parts, [11, 15, 16, 18])),
        NPM: formatCount(getReportField(parts, 17))
      }
    }

    const existing = stageEntry.scoreMap.get(shooterKey)
    if (!existing || compareReportStageScores(score, existing) < 0) {
      stageEntry.scoreMap.set(shooterKey, score)
    }

    ensureShooter(shooterMap, competitor.shooterName, competitor.division ?? null)
  }
}

function compareReportStageScores(left: ReportStageScore, right: ReportStageScore) {
  if (left.stagePoints !== right.stagePoints) {
    return right.stagePoints - left.stagePoints
  }

  const leftPlacement = left.overallPlacementValue ?? Number.MAX_SAFE_INTEGER
  const rightPlacement = right.overallPlacementValue ?? Number.MAX_SAFE_INTEGER
  if (leftPlacement !== rightPlacement) {
    return leftPlacement - rightPlacement
  }

  return left.shooterName.localeCompare(right.shooterName)
}

function compareDivisionMatchResults(
  left: ParsedMatchResult,
  leftPoints: number,
  right: ParsedMatchResult,
  rightPoints: number
) {
  if (leftPoints !== rightPoints) {
    return rightPoints - leftPoints
  }

  const leftPlacement = parseInteger(left.overallPlacement ?? '') ?? Number.MAX_SAFE_INTEGER
  const rightPlacement = parseInteger(right.overallPlacement ?? '') ?? Number.MAX_SAFE_INTEGER
  if (leftPlacement !== rightPlacement) {
    return leftPlacement - rightPlacement
  }

  return left.shooterName.localeCompare(right.shooterName)
}

function assignDensePlacements<T>(
  items: T[],
  getRankingValue: (item: T) => number,
  applyPlacement: (item: T, placement: string) => void
) {
  let currentPlacement = 0
  let previousValue: number | null = null

  for (const item of items) {
    const rankingValue = getRankingValue(item)
    if (previousValue === null || !areRankValuesEqual(previousValue, rankingValue)) {
      currentPlacement += 1
      previousValue = rankingValue
    }

    applyPlacement(item, String(currentPlacement))
  }
}

function areRankValuesEqual(left: number, right: number) {
  return Math.abs(left - right) <= REPORT_RANK_TOLERANCE
}

function toParsedStageResult(score: ReportStageScore, maxPoints: number): ParsedStageResult {
  return {
    shooterName: score.shooterName,
    overallPlacement: score.overallPlacement,
    divisionPlacement: null,
    division: score.division ?? null,
    className: score.className,
    powerFactor: score.powerFactor,
    stats: {
      '%': formatPercent(maxPoints > 0 ? (score.stagePoints / maxPoints) * 100 : 0),
      HF: formatNumber(score.hitFactor, 4),
      Time: score.timeText,
      Pts: score.pointsText,
      'Stg Pts': score.stagePointsText,
      A: score.counts.A,
      C: score.counts.C,
      D: score.counts.D,
      M: score.counts.M,
      NPM: score.counts.NPM,
      NS: score.counts.NS,
      PROC: score.counts.PROC
    },
    divisionStats: null
  }
}

function parseCsvLine(value: string) {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!

    if (character === '"') {
      if (inQuotes && value[index + 1] === '"') {
        current += '"'
        index += 1
        continue
      }

      inQuotes = !inQuotes
      continue
    }

    if (character === ',' && !inQuotes) {
      fields.push(current)
      current = ''
      continue
    }

    current += character
  }

  fields.push(current)
  return fields
}

function getReportField(parts: string[], index: number) {
  return parts[index]?.trim() ?? ''
}

function parseInteger(value: string) {
  if (!value) {
    return null
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function parseNumber(value: string) {
  if (!value) {
    return 0
  }

  let normalized = value.replace(/,/g, '').trim()
  while (normalized.split('.').length > 2) {
    normalized = normalized.replace('.', '')
  }

  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeReportTime(value: string) {
  let normalized = value.replace(/,/g, '').trim()
  while (normalized.split('.').length > 2) {
    normalized = normalized.replace('.', '')
  }
  return normalized
}

function formatNumber(value: number, digits: number) {
  if (!Number.isFinite(value)) {
    return digits === 0 ? '0' : (0).toFixed(digits)
  }

  if (digits === 0) {
    return Math.round(value).toString()
  }

  return value.toFixed(digits)
}

function formatPercent(value: number) {
  return formatNumber(value, 2)
}

function formatCount(value: string | number) {
  if (typeof value === 'number') {
    return Math.round(value).toString()
  }
  return value.trim() || '0'
}

function sumReportCounts(parts: string[], indexes: number[]) {
  return indexes.reduce((sum, index) => sum + parseNumber(getReportField(parts, index)), 0)
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

function inferPlacementIndex(headers: string[], rows: string[][], shooterIndex: number) {
  const explicitPlacementIndex = findHeaderIndex(headers, PLACE_HEADER_HINTS)
  if (explicitPlacementIndex >= 0) {
    return explicitPlacementIndex
  }

  for (let index = 0; index < shooterIndex; index += 1) {
    const columnValues = rows
      .map((row) => row[index]?.trim() || '')
      .filter(Boolean)

    if (columnValues.length === 0) {
      continue
    }

    const numericValueCount = columnValues.filter((value) => /^\d+$/.test(value)).length
    if (numericValueCount === columnValues.length) {
      return index
    }
  }

  return -1
}

function prettifyHeader(header: string) {
  return header
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
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
  const placementIndex = inferPlacementIndex(headers, rows, shooterIndex)
  const classIndex = findHeaderIndex(headers, CLASS_HEADER_HINTS)
  const powerFactorIndex = findHeaderIndex(headers, POWER_FACTOR_HEADER_HINTS)

  return rows
    .map((row) => {
      const shooterCell = parseShooterCell(row[shooterIndex]?.trim() || '')
      const shooterName = shooterCell.shooterName
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
        overallPlacement: placementIndex >= 0
          ? row[placementIndex]?.trim() || shooterCell.embeddedPlacement || undefined
          : shooterCell.embeddedPlacement || undefined,
        divisionPlacement: null,
        division,
        className,
        powerFactor,
        stats,
        divisionStats: null
      } satisfies ParsedStageResult
    })
    .filter(Boolean) as ParsedStageResult[]
}

function applyDivisionRows(
  resultsByShooter: Map<string, ParsedStageResult | ParsedMatchResult>,
  headers: string[],
  rows: string[][],
  divisionName: string,
  shooterMap: Map<string, ParsedShooter>
) {
  const shooterIndex = findHeaderIndex(headers, SHOOTER_HEADER_HINTS)
  if (shooterIndex === -1) return

  const placementIndex = inferPlacementIndex(headers, rows, shooterIndex)
  const classIndex = findHeaderIndex(headers, CLASS_HEADER_HINTS)
  const powerFactorIndex = findHeaderIndex(headers, POWER_FACTOR_HEADER_HINTS)

  for (const row of rows) {
    const shooterCell = parseShooterCell(row[shooterIndex]?.trim() || '')
    const shooterName = shooterCell.shooterName
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
    result.divisionPlacement = placementIndex >= 0
      ? row[placementIndex]?.trim() || shooterCell.embeddedPlacement || null
      : shooterCell.embeddedPlacement || null
    result.className = result.className ?? (classIndex >= 0 ? row[classIndex]?.trim() || undefined : undefined)
    result.powerFactor = result.powerFactor ?? (powerFactorIndex >= 0 ? row[powerFactorIndex]?.trim() || undefined : undefined)
    result.divisionStats = Object.keys(divisionStats).length > 0 ? divisionStats : result.divisionStats ?? null
    ensureShooter(shooterMap, shooterName, result.division)
  }
}
