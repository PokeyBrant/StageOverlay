import path from 'node:path'
import { app } from 'electron'
import { chromium } from 'playwright'
import { parseDashboardMatches, parseResultsHtml } from './parsers'
import type { MatchReference, ScrapedMatch } from './types'

function getUserDataDir() {
  return path.join(app.getPath('userData'), 'playwright-profile')
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
    const matches = parseDashboardMatches(dashboardHtml)

    const viewAllUrl = await page.evaluate(() => {
      const recentHeader = Array.from(document.querySelectorAll('h4')).find((node) =>
        (node.textContent || '').includes('Recent Events')
      )
      const link = recentHeader?.querySelector('a') as HTMLAnchorElement | null
      return link?.href || null
    })

    if (!viewAllUrl) {
      return matches
    }

    await page.goto(viewAllUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(3000)

    const historyMatches = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'))
      return rows
        .map((row, index) => {
          const cells = row.querySelectorAll('td')
          const link = row.querySelector('a.matchLink') as HTMLAnchorElement | null
          const matchId = link?.getAttribute('matchid') || row.getAttribute('matchid') || `${index}`
          const name = link?.textContent?.trim() || ''
          const date = cells[2]?.textContent?.trim() || null
          if (!name || !matchId) return null
          return {
            id: `recent-${matchId}`,
            name,
            date,
            source: 'recent' as const,
            url: `https://practiscore.com/results/new/${matchId}`,
            resultsUrl: `https://practiscore.com/results/new/${matchId}`
          }
        })
        .filter(Boolean)
    })

    const merged = new Map<string, MatchReference>()
    for (const match of matches) merged.set(match.id, match)
    for (const match of historyMatches) {
      if (match) merged.set(match.id, match)
    }
    return Array.from(merged.values())
  } finally {
    await context.close()
  }
}

export async function scrapeMatchDetails(matchRef: MatchReference | { url: string }) {
  const context = await createContext()
  try {
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage()
    const initialUrl = matchRef.url
    await page.goto(initialUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(4000)

    let resultsUrl = await page.evaluate(() => {
      const directLink = document.querySelector('a[href*="/results/new/"]') as HTMLAnchorElement | null
      return directLink?.href || null
    })

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
    const html = await page.content()
    const parsed = parseResultsHtml(html, resultsUrl)
    return {
      ...parsed,
      sourceUrl: initialUrl,
      resultsUrl
    } satisfies ScrapedMatch
  } finally {
    await context.close()
  }
}
