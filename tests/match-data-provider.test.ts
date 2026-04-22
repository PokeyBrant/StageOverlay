import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getMatchDataProviderStatus, importMatchFile } from '../electron/matchDataProvider.ts'

const providerStatus = await getMatchDataProviderStatus()

assert.deepEqual(providerStatus, {
  supportsFileImport: true,
  headline: 'Match file import enabled',
  detail: 'This public build loads match data from an imported match page file.'
})

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-overlay-public-provider-'))
const sourceFile = path.join(tempDir, 'import.html')
const fixtureHtml = fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'results.html'), 'utf8')
fs.writeFileSync(sourceFile, fixtureHtml, 'utf8')

const importedMatch = await importMatchFile(sourceFile, 'https://example.com/results/imported')
assert.equal(importedMatch.name, 'Spring Championship Results')
assert.equal(importedMatch.shooters.length, 2)
assert.equal(importedMatch.stages.length, 2)

fs.rmSync(tempDir, { recursive: true, force: true })

console.log('Match data provider tests passed.')
