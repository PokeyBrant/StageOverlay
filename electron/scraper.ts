import path from 'node:path'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { app } from 'electron'
import { chromium } from 'playwright'
import { cleanMatchTitle, findShooterResult, parseDashboardMatches, parseResultsHtml, parseResultsTable } from './parsers'
import { pickResultsControlIndexes } from './resultsControls'
import type { Locator, Page } from 'playwright'
import type { MatchReference, ScrapedMatch, ScrapedStageResult } from './types'
import type { DropdownOption } from './resultsControls'

type VisibleTableSnapshot = {
  matchName: string
  headers: string[]
  rows: string[][]
}

type ScopeScrape = {
  matchName: string
  results: ScrapedStageResult[]
  shooterName: string | null
  shooterDivision: string | null
}

function getUserDataDir() {
  return path.join(app.getPath('userData'), 'playwright-profile')
}

async function getPreferredShooterName() {
  const filePath = path.join(app.getPath('userData'), 'preferences.json')
  if (!fs.existsSync(filePath)) {
    return ''
  }

  try {
    const raw = await fs.promises.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as { preferredShooterName?: string }
    return parsed.preferredShooterName?.trim() || ''
  } catch {
    return ''
  }
}

async function createContext() {
  return chromium.launchPersistentContext(getUserDataDir(), {
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation']
  })
}

export async function openAuthenticationWindow() {
  const context = await createContext()
  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage()
  await page.goto('https://practiscore.com/dashboard/home', { waitUntil: 'domcontentloaded', timeout: 60000 })
  return new Promise<boolean>((resolve) => {
    context.on('close', () => resolve(true))
  })
}

export async function fetchRecentMatches() {
  const context = await createContext()
  try {
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage()
    await page.goto('https://practiscore.com/dashboard/home', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(5000)

    const dashboardHtml = await page.content()
    return parseDashboardMatches(dashboardHtml)
  } finally {
    await context.close()
  }
}

export async function scrapeMatchDetails(matchRef: MatchReference | { url: string }) {
  const context = await createContext()
  try {
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage()
    const initialUrl = 'resultsUrl' in matchRef && matchRef.resultsUrl ? matchRef.resultsUrl : matchRef.url
    await page.goto(initialUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(4000)

    let resultsUrl = 'resultsUrl' in matchRef ? matchRef.resultsUrl ?? null : null

    if (!resultsUrl) {
      resultsUrl = await page.evaluate(() => {
        const directLink = document.querySelector('a[href*="/results/new/"]') as HTMLAnchorElement | null
        return directLink?.href || null
      })
    }

    if (!resultsUrl && /\/results\//i.test(initialUrl)) {
      resultsUrl = initialUrl
    }

    if (!resultsUrl && /\/register$/i.test(initialUrl)) {
      resultsUrl = `${initialUrl.replace(/\/register$/i, '')}/results`
    }

    if (!resultsUrl) {
      throw new Error('Could not determine a results URL from the provided match.')
    }

    await page.goto(resultsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(4000)
    const preferredShooterName = await getPreferredShooterName()
    const dropdownDrivenMatch = await scrapeDropdownDrivenMatch(page, resultsUrl, preferredShooterName)
    const parsedHtml = parseResultsHtml(await page.content(), resultsUrl)
    const parsed = dropdownDrivenMatch && dropdownDrivenMatch.stages.length > 0 ? dropdownDrivenMatch : parsedHtml
    const canonicalMatchName = 'name' in matchRef && matchRef.name ? cleanMatchTitle(matchRef.name) : cleanMatchTitle(parsed.name)
    return {
      ...parsed,
      sourceUrl: initialUrl,
      resultsUrl,
      name: canonicalMatchName
    } satisfies ScrapedMatch
  } finally {
    await context.close()
  }
}

async function scrapeDropdownDrivenMatch(page: Page, resultsUrl: string, preferredShooterName: string): Promise<ScrapedMatch | null> {
  const controls = await getResultsControls(page)
  if (!controls) {
    return null
  }

  const { scopeSelect, divisionSelect, scopeOptions } = controls
  if (scopeOptions.length === 0) {
    return null
  }

  if (scopeOptions.length < 2) {
    return null
  }

  const matchScope = await scrapeScope(page, scopeSelect, divisionSelect, scopeOptions[0]!, preferredShooterName, null, null)
  const stages = []
  let resolvedShooterName = matchScope.shooterName
  let resolvedShooterDivision = matchScope.shooterDivision

  const stageOptions = scopeOptions.slice(1)
  for (let index = 0; index < stageOptions.length; index += 1) {
    const scopeOption = stageOptions[index]!
    const stageScope = await scrapeScope(page, scopeSelect, divisionSelect, scopeOption, preferredShooterName, resolvedShooterName, resolvedShooterDivision)
    resolvedShooterName = resolvedShooterName ?? stageScope.shooterName
    resolvedShooterDivision = resolvedShooterDivision ?? stageScope.shooterDivision
    stages.push({
      id: crypto.randomUUID(),
      name: scopeOption.label || `Stage ${index + 1}`,
      order: index + 1,
      results: stageScope.results
    })
  }

  const shooterMap = new Map<string, { id: string; name: string; division: string | null }>()
  for (const result of matchScope.results) {
    const key = result.shooterName.toLowerCase()
    if (!shooterMap.has(key)) {
      shooterMap.set(key, {
        id: crypto.randomUUID(),
        name: result.shooterName,
        division: result.division ?? null
      })
    }
  }

  return {
    id: crypto.randomUUID(),
    sourceUrl: resultsUrl,
    resultsUrl,
    name: cleanMatchTitle(matchScope.matchName),
    matchResults: matchScope.results,
    stages,
    shooters: Array.from(shooterMap.values())
  }
}

async function scrapeScope(
  page: Page,
  scopeSelect: Locator,
  divisionSelect: Locator,
  scopeOption: DropdownOption,
  preferredShooterName: string,
  shooterName: string | null,
  shooterDivision: string | null
): Promise<ScopeScrape> {
  await selectDropdownOption(scopeSelect, scopeOption)
  await waitForResultsTable(page)

  const overallOption = await findOverallDivisionOption(divisionSelect)
  if (overallOption) {
    await selectDropdownOption(divisionSelect, overallOption)
    await waitForResultsTable(page)
  }

  const overallSnapshot = await readVisibleResultsTable(page)
  const results = parseResultsTable(overallSnapshot.headers, overallSnapshot.rows)
  if (results.length === 0) {
    throw new Error(`Could not read result rows for ${scopeOption.label || 'the selected scope'}.`)
  }

  const matchedOverallResult = findShooterResult(results, preferredShooterName, shooterName)
  const resolvedShooterName = shooterName ?? matchedOverallResult?.shooterName ?? null
  const resolvedShooterDivision = shooterDivision ?? matchedOverallResult?.division ?? null

  if (resolvedShooterDivision) {
    const divisionOptions = await listDropdownOptions(divisionSelect)
    const matchingDivisionOption = divisionOptions.find((option) => normalizeOptionLabel(option.label) === normalizeOptionLabel(resolvedShooterDivision))
    if (matchingDivisionOption && normalizeOptionLabel(matchingDivisionOption.label) !== 'overall') {
      await selectDropdownOption(divisionSelect, matchingDivisionOption)
      await waitForResultsTable(page)

      const divisionSnapshot = await readVisibleResultsTable(page)
      const divisionResults = parseResultsTable(divisionSnapshot.headers, divisionSnapshot.rows)
      const divisionResult = findShooterResult(divisionResults, preferredShooterName, resolvedShooterName)
      if (matchedOverallResult && divisionResult) {
        matchedOverallResult.division = matchedOverallResult.division ?? resolvedShooterDivision
        matchedOverallResult.divisionPlacement = divisionResult.overallPlacement ?? null
        matchedOverallResult.className = matchedOverallResult.className ?? divisionResult.className
        matchedOverallResult.powerFactor = matchedOverallResult.powerFactor ?? divisionResult.powerFactor
        matchedOverallResult.divisionStats = divisionResult.stats
      }

      if (overallOption) {
        await selectDropdownOption(divisionSelect, overallOption)
        await waitForResultsTable(page)
      }
    }
  }

  return {
    matchName: cleanMatchTitle(overallSnapshot.matchName),
    results,
    shooterName: resolvedShooterName,
    shooterDivision: resolvedShooterDivision
  }
}

async function getResultsControls(page: Page) {
  try {
    await page.waitForFunction(() => document.querySelectorAll('select').length >= 2, { timeout: 15000 })
  } catch {
    return null
  }

  const selects = page.locator('select')
  const selectCount = await selects.count()
  if (selectCount < 2) {
    return null
  }

  const candidates: Array<{ locator: Locator; options: DropdownOption[] }> = []
  for (let index = 0; index < selectCount; index += 1) {
    const locator = selects.nth(index)
    const options = await listDropdownOptions(locator)
    if (options.length > 0) {
      candidates.push({ locator, options })
    }
  }

  const controlIndexes = pickResultsControlIndexes(candidates)
  if (!controlIndexes) {
    return null
  }

  const scopeSelect = candidates[controlIndexes.scopeIndex]!.locator
  const divisionSelect = candidates[controlIndexes.divisionIndex]!.locator
  const scopeOptions = candidates[controlIndexes.scopeIndex]!.options
  return {
    scopeSelect,
    divisionSelect,
    scopeOptions: scopeOptions.filter((option) => option.label)
  }
}

async function listDropdownOptions(select: Locator): Promise<DropdownOption[]> {
  return select.locator('option').evaluateAll((options) =>
    options
      .map((option) => ({
        value: (option as HTMLOptionElement).value ?? '',
        label: option.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        disabled: (option as HTMLOptionElement).disabled
      }))
      .filter((option) => !option.disabled && option.label)
      .map(({ value, label }) => ({ value, label }))
  )
}

async function findOverallDivisionOption(select: Locator) {
  const options = await listDropdownOptions(select)
  return options.find((option) => normalizeOptionLabel(option.label) === 'overall') ?? options[0] ?? null
}

async function selectDropdownOption(select: Locator, option: DropdownOption) {
  await select.evaluate((node, requestedOption) => {
    const selectElement = node as HTMLSelectElement
    const normalizedLabel = (value: string) => value.replace(/\s+/g, ' ').trim()
    const matchingOption = Array.from(selectElement.options).find((candidate) => {
      if (requestedOption.value && candidate.value === requestedOption.value) {
        return true
      }
      return normalizedLabel(candidate.textContent || '') === requestedOption.label
    })

    if (!matchingOption) {
      throw new Error(`Dropdown option not found: ${requestedOption.label}`)
    }

    selectElement.value = matchingOption.value
    matchingOption.selected = true
    selectElement.dispatchEvent(new Event('input', { bubbles: true }))
    selectElement.dispatchEvent(new Event('change', { bubbles: true }))
  }, option)
}

async function waitForResultsTable(page: Page) {
  await page.waitForFunction(() => {
    const isVisible = (element: Element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    return Array.from(document.querySelectorAll('table')).some((table) => {
      if (!isVisible(table)) return false
      const headers = Array.from(table.querySelectorAll('thead th, tr th')).map((node) => node.textContent?.toLowerCase().trim() || '')
      const hasShooter = headers.some((header) => ['name', 'competitor', 'shooter'].some((hint) => header.includes(hint)))
      const hasMetrics = headers.some((header) =>
        ['time', 'hit factor', 'hf', 'points', 'penalties', 'penalty', 'percent', '%', 'stage points'].some((hint) => header.includes(hint))
      )
      return hasShooter && hasMetrics && table.querySelectorAll('tbody tr').length > 0
    })
  }, { timeout: 15000 })
}

async function readVisibleResultsTable(page: Page): Promise<VisibleTableSnapshot> {
  const snapshot = await page.evaluate(() => {
    const isVisible = (element: Element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    const scoreHeaderHints = ['time', 'hit factor', 'hf', 'points', 'penalties', 'penalty', 'percent', '%', 'stage points']
    const shooterHeaderHints = ['name', 'competitor', 'shooter']
    const tables = Array.from(document.querySelectorAll('table'))
      .filter((table) => isVisible(table))
      .map((table) => {
        const headers = Array.from(table.querySelectorAll('thead th, tr th')).map((node) => node.textContent?.replace(/\s+/g, ' ').trim() || '')
        const rows = Array.from(table.querySelectorAll('tbody tr')).map((row) =>
          Array.from(row.querySelectorAll('td, th')).map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() || '')
        )
        return { headers, rows }
      })
      .filter((table) => {
        const normalizedHeaders = table.headers.map((header) => header.toLowerCase())
        const hasShooter = normalizedHeaders.some((header) => shooterHeaderHints.some((hint) => header.includes(hint)))
        const hasMetrics = normalizedHeaders.some((header) => scoreHeaderHints.some((hint) => header.includes(hint)))
        return hasShooter && hasMetrics && table.rows.length > 0
      })
      .sort((left, right) => right.rows.length - left.rows.length)

    const chosenTable = tables[0] ?? null
    return {
      matchName:
        document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() ||
        document.title.replace(/\s*-\s*practiscore\.com/i, '').trim() ||
        'PractiScore Match',
      headers: chosenTable?.headers ?? [],
      rows: chosenTable?.rows ?? []
    }
  })

  if (snapshot.headers.length === 0 || snapshot.rows.length === 0) {
    throw new Error('Could not identify the active PractiScore results table.')
  }

  return snapshot
}

function normalizeOptionLabel(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}
