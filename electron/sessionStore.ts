import crypto from 'node:crypto'
import type { ScrapedMatch, SessionMatch } from './types'

const matches = new Map<string, SessionMatch>()

export function putSessionMatch(match: ScrapedMatch) {
  const sessionId = crypto.randomUUID()
  const sessionMatch: SessionMatch = { sessionId, match }
  matches.set(sessionId, sessionMatch)
  return sessionMatch
}

export function getSessionMatch(sessionId: string) {
  return matches.get(sessionId) ?? null
}

export function clearSessions() {
  matches.clear()
}
