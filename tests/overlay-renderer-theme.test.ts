import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generateDecorativeCircles } from '../electron/overlayDecor.ts'
import {
  buildThemeDecorationSeed,
  getThemeConfig,
  loadBackgroundImageDataUrl,
  resolveCanvasDimensions
} from '../electron/overlayRenderer.ts'
import { overlayThemeIds } from '../electron/types.ts'

for (const theme of overlayThemeIds) {
  const themeConfig = getThemeConfig(theme)

  const horizontalSeed = buildThemeDecorationSeed(theme, 'horizontal', 'theme-seed')
  const horizontalFirstPass = generateDecorativeCircles({
    width: 1800,
    height: 540,
    layout: 'horizontal',
    config: themeConfig.decoration,
    avoidRects: [],
    seed: horizontalSeed
  })
  const horizontalSecondPass = generateDecorativeCircles({
    width: 1800,
    height: 540,
    layout: 'horizontal',
    config: themeConfig.decoration,
    avoidRects: [],
    seed: horizontalSeed
  })

  assert.deepEqual(horizontalFirstPass, horizontalSecondPass)
  assert.ok(horizontalFirstPass.length > 0)

  const verticalPass = generateDecorativeCircles({
    width: 1080,
    height: 1400,
    layout: 'vertical',
    config: themeConfig.decoration,
    avoidRects: [],
    seed: buildThemeDecorationSeed(theme, 'vertical', 'theme-seed')
  })

  assert.ok(verticalPass.length > 0)
}

const sameThemeFirstSeed = generateDecorativeCircles({
  width: 1800,
  height: 540,
  layout: 'horizontal',
  config: getThemeConfig('carbon').decoration,
  avoidRects: [],
  seed: buildThemeDecorationSeed('carbon', 'horizontal', 'seed-a')
})

const sameThemeSecondSeed = generateDecorativeCircles({
  width: 1800,
  height: 540,
  layout: 'horizontal',
  config: getThemeConfig('carbon').decoration,
  avoidRects: [],
  seed: buildThemeDecorationSeed('carbon', 'horizontal', 'seed-b')
})

assert.notDeepEqual(sameThemeFirstSeed, sameThemeSecondSeed)

assert.deepEqual(resolveCanvasDimensions('horizontal', 1080), { width: 1080, height: 324 })
assert.deepEqual(resolveCanvasDimensions('horizontal', 2160), { width: 2160, height: 648 })
assert.deepEqual(resolveCanvasDimensions('vertical', 1080), { width: 833, height: 1080 })
assert.deepEqual(resolveCanvasDimensions('vertical', 2160), { width: 1666, height: 2160 })

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-overlay-background-test-'))
const svgPath = path.join(tempDir, 'background.svg')
fs.writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#123456"/></svg>', 'utf8')

const backgroundDataUrl = await loadBackgroundImageDataUrl(svgPath)
assert.ok(backgroundDataUrl?.startsWith('data:image/svg+xml;base64,'))

fs.rmSync(tempDir, { recursive: true, force: true })

console.log('Overlay renderer theme tests passed.')
