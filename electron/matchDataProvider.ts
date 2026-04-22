import fs from 'node:fs'
import { parseResultsHtml } from './matchFileParser.ts'
import type { MatchDataProviderStatus } from './types'

const publicProviderStatus: MatchDataProviderStatus = {
  supportsFileImport: true,
  headline: 'Match file import enabled',
  detail: 'This public build loads match data from an imported match page file.'
}

export async function getMatchDataProviderStatus() {
  return publicProviderStatus
}

export async function importMatchFile(filePath: string, sourceUrl?: string | null) {
  const html = await fs.promises.readFile(filePath, 'utf8')
  const importSourceUrl = sourceUrl?.trim() || filePath
  const parsedMatch = parseResultsHtml(html, importSourceUrl)
  if (parsedMatch.matchResults.length === 0 && parsedMatch.stages.length === 0 && parsedMatch.shooters.length === 0) {
    throw new Error('The selected file did not contain usable match results. Export or save the fully loaded match page, then import it again.')
  }
  return parsedMatch
}

export async function disposeMatchDataProvider() {
  return undefined
}
