import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parseDashboardMatches, parseResultsHtml, resolveShooter } from '../electron/parsers.ts'

const fixturesDir = path.join(process.cwd(), 'tests', 'fixtures')

const dashboardHtml = fs.readFileSync(path.join(fixturesDir, 'dashboard.html'), 'utf8')
const dashboardMatches = parseDashboardMatches(dashboardHtml)
assert.equal(dashboardMatches.length, 2)
assert.equal(dashboardMatches[0]?.name, 'Spring Championship')
assert.equal(dashboardMatches[1]?.source, 'recent')

const resultsHtml = fs.readFileSync(path.join(fixturesDir, 'results.html'), 'utf8')
const match = parseResultsHtml(resultsHtml, 'https://practiscore.com/results/new/example')
assert.equal(match.name, 'Spring Championship Results')
assert.equal(match.stages.length, 2)
assert.equal(match.shooters.length, 2)
assert.equal(match.stages[0]?.results[0]?.stats['Hit Factor'], '6.32')

const exact = resolveShooter(match, 'Jane Doe')
assert.equal(exact.confidence, 'exact')
assert.ok(exact.shooterId)

const partial = resolveShooter(match, 'jane')
assert.equal(partial.confidence, 'partial')

console.log('Parser tests passed.')
