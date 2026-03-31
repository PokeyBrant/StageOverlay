import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { findShooterResult, matchesNameParts, parseDashboardMatches, parseResultsHtml, parseResultsTable, resolveShooter } from '../electron/parsers.ts'
import { pickResultsControlIndexes } from '../electron/resultsControls.ts'

const fixturesDir = path.join(process.cwd(), 'tests', 'fixtures')

const dashboardHtml = fs.readFileSync(path.join(fixturesDir, 'dashboard.html'), 'utf8')
const dashboardMatches = parseDashboardMatches(dashboardHtml)
assert.equal(dashboardMatches.length, 1)
assert.equal(dashboardMatches[0]?.name, 'Winter Classic')
assert.equal(dashboardMatches[0]?.source, 'recent')
assert.equal(dashboardMatches[0]?.resultsUrl, 'https://practiscore.com/results/new/winter-classic-2026')

const resultsHtml = fs.readFileSync(path.join(fixturesDir, 'results.html'), 'utf8')
const match = parseResultsHtml(resultsHtml, 'https://practiscore.com/results/new/example')
assert.equal(match.name, 'Spring Championship Results')
assert.equal(match.matchResults.length, 2)
assert.equal(match.stages.length, 2)
assert.equal(match.stages[0]?.name, 'Stage 1 - The Long Walk')
assert.equal(match.stages[1]?.name, 'Stage 2 - Tight Corners')
assert.equal(match.shooters.length, 2)
assert.deepEqual(
  match.shooters.map((shooter) => shooter.name),
  ['Jane Doe', 'Smith, John']
)
assert.equal(match.shooters.find((shooter) => shooter.name === 'Jane Doe')?.division, 'Carry Optics')
assert.equal(match.shooters.find((shooter) => shooter.name === 'Smith, John')?.division, 'Open')
assert.equal(match.matchResults.find((result) => result.shooterName === 'Smith, John')?.overallPlacement, '2')
assert.equal(match.matchResults.find((result) => result.shooterName === 'Smith, John')?.divisionPlacement, '1')
assert.equal(match.matchResults.find((result) => result.shooterName === 'Smith, John')?.stats['Match Points'], '418.07')
assert.equal(match.matchResults.find((result) => result.shooterName === 'Smith, John')?.divisionStats?.['Match Points'], '418.07')
assert.equal(match.stages[0]?.results[0]?.stats['Hit Factor'], '6.32')
assert.equal(match.stages[0]?.results[0]?.overallPlacement, '1')
assert.equal(match.stages[0]?.results.find((result) => result.shooterName === 'Smith, John')?.divisionPlacement, '1')
assert.equal(match.stages[1]?.results.find((result) => result.shooterName === 'Smith, John')?.divisionPlacement, null)

const exact = resolveShooter(match, 'Jane Doe')
assert.equal(exact.confidence, 'exact')
assert.ok(exact.shooterId)
assert.equal(exact.candidates[0]?.division, 'Carry Optics')

const reordered = resolveShooter(match, 'John Smith')
assert.equal(reordered.confidence, 'exact')
assert.equal(reordered.candidates[0]?.name, 'Smith, John')

const prefixed = resolveShooter(match, '2 - John Smith')
assert.equal(prefixed.confidence, 'exact')
assert.equal(prefixed.candidates[0]?.name, 'Smith, John')

const partial = resolveShooter(match, 'jane')
assert.equal(partial.confidence, 'partial')
assert.equal(matchesNameParts('Smith, John', ['john', 'smith']), true)
assert.equal(matchesNameParts('12 - Smith, John', ['john', 'smith']), true)

const activeTableResults = parseResultsTable(
  ['Place', 'Name', 'Division', 'Hit Factor', 'Time'],
  [
    ['1', '12 - Brandt, Jason', 'Limited Optics', '7.88', '10.10'],
    ['2', '2 - Smith, John', 'Open', '7.22', '10.81']
  ]
)
assert.equal(activeTableResults[0]?.shooterName, 'Brandt, Jason')
assert.equal(findShooterResult(activeTableResults, 'Jason Brandt')?.division, 'Limited Optics')
assert.equal(findShooterResult(activeTableResults, 'Brandt, Jason')?.overallPlacement, '1')

const embeddedPlacementResults = parseResultsTable(
  ['Name', 'Division', 'Hit Factor', 'Time'],
  [
    ['12 - Brant, Jason', 'Limited Optics', '7.88', '10.10'],
    ['2 - Smith, John', 'Open', '7.22', '10.81']
  ]
)
assert.equal(embeddedPlacementResults[0]?.shooterName, 'Brant, Jason')
assert.equal(embeddedPlacementResults[0]?.overallPlacement, '12')

const compactEmbeddedPlacementResults = parseResultsTable(
  ['Name', 'Division', 'Hit Factor', 'Time'],
  [
    ['12-Brant, Jason', 'Limited Optics', '7.88', '10.10'],
    ['2-Smith, John', 'Open', '7.22', '10.81']
  ]
)
assert.equal(compactEmbeddedPlacementResults[0]?.shooterName, 'Brant, Jason')
assert.equal(compactEmbeddedPlacementResults[0]?.overallPlacement, '12')

const unlabeledPlacementResults = parseResultsTable(
  ['', 'Name', 'Division', 'Hit Factor', 'Time'],
  [
    ['12', 'Brant, Jason', 'Limited Optics', '7.88', '10.10'],
    ['2', 'Smith, John', 'Open', '7.22', '10.81']
  ]
)
assert.equal(unlabeledPlacementResults[0]?.shooterName, 'Brant, Jason')
assert.equal(unlabeledPlacementResults[0]?.overallPlacement, '12')

const controlIndexes = pickResultsControlIndexes([
  {
    options: [
      { value: '10', label: '10' },
      { value: '25', label: '25' },
      { value: '50', label: '50' }
    ]
  },
  {
    options: [
      { value: 'overall', label: 'Overall' },
      { value: 'stage-1', label: 'Stage 1 - The Long Walk' },
      { value: 'stage-2', label: 'Stage 2 - Tight Corners' }
    ]
  },
  {
    options: [
      { value: 'overall', label: 'Overall' },
      { value: 'co', label: 'Carry Optics' },
      { value: 'lo', label: 'Limited Optics' }
    ]
  }
])
assert.deepEqual(controlIndexes, { scopeIndex: 1, divisionIndex: 2 })

const missingScopeIndexes = pickResultsControlIndexes([
  {
    options: [
      { value: 'overall', label: 'Overall' },
      { value: 'lo', label: 'Limited Optics' }
    ]
  },
  {
    options: [
      { value: '10', label: '10' },
      { value: '25', label: '25' }
    ]
  }
])
assert.equal(missingScopeIndexes, null)

console.log('Parser tests passed.')
