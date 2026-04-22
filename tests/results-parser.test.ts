import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { buildDecorationSeed, generateDecorativeCircles } from '../electron/overlayDecor.ts'
import { findShooterResult, matchesNameParts, parseResultsHtml, parseResultsTable, resolveShooter } from '../electron/parsers.ts'

const fixturesDir = path.join(process.cwd(), 'tests', 'fixtures')

const resultsHtml = fs.readFileSync(path.join(fixturesDir, 'results.html'), 'utf8')
const match = parseResultsHtml(resultsHtml, 'https://example.com/results/example')
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

const decorationSeed = buildDecorationSeed(['stage-summary', 'stage-1', 'shooter-1', 'vertical', 'carbon'])
const decorationConfig = {
  safePadding: 24,
  avoidPadding: 12,
  orbsByLayout: {
    horizontal: [
      { anchorX: 0.82, anchorY: 0.18, radius: [90, 110] as [number, number], opacity: [0.1, 0.14] as [number, number], color: 'accent' as const, xJitter: 12, yJitter: 12 }
    ],
    vertical: [
      { anchorX: 0.84, anchorY: 0.16, radius: [90, 110] as [number, number], opacity: [0.1, 0.14] as [number, number], color: 'accent' as const, xJitter: 12, yJitter: 12 }
    ]
  },
  dotsByLayout: {
    horizontal: {
      count: [8, 10] as [number, number],
      radius: [4, 12] as [number, number],
      opacity: [0.08, 0.16] as [number, number],
      ringChance: 0.3,
      minGap: 8,
      colorWeights: [
        { color: 'accent' as const, weight: 3 },
        { color: 'muted' as const, weight: 2 },
        { color: 'panel' as const, weight: 1 }
      ]
    },
    vertical: {
      count: [8, 10] as [number, number],
      radius: [4, 12] as [number, number],
      opacity: [0.08, 0.16] as [number, number],
      ringChance: 0.3,
      minGap: 8,
      colorWeights: [
        { color: 'accent' as const, weight: 3 },
        { color: 'muted' as const, weight: 2 },
        { color: 'panel' as const, weight: 1 }
      ]
    }
  }
}
const protectedRects = [
  { x: 100, y: 120, width: 420, height: 220 },
  { x: 560, y: 420, width: 420, height: 440 }
]
const generatedOnce = generateDecorativeCircles({
  width: 1080,
  height: 1400,
  layout: 'vertical',
  config: decorationConfig,
  avoidRects: protectedRects,
  seed: decorationSeed
})
const generatedTwice = generateDecorativeCircles({
  width: 1080,
  height: 1400,
  layout: 'vertical',
  config: decorationConfig,
  avoidRects: protectedRects,
  seed: decorationSeed
})
const generatedDifferent = generateDecorativeCircles({
  width: 1080,
  height: 1400,
  layout: 'vertical',
  config: decorationConfig,
  avoidRects: protectedRects,
  seed: buildDecorationSeed(['stage-summary', 'stage-2', 'shooter-1', 'vertical', 'carbon'])
})
assert.deepEqual(generatedOnce, generatedTwice)
assert.notDeepEqual(generatedOnce, generatedDifferent)
assert.equal(
  generatedOnce.some((circle) => protectedRects.some((rect) => circle.cx > rect.x && circle.cx < rect.x + rect.width && circle.cy > rect.y && circle.cy < rect.y + rect.height)),
  false
)

console.log('Parser tests passed.')
