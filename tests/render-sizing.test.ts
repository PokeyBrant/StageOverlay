import assert from 'node:assert/strict'
import {
  clampCanvasAxis,
  detectCanvasPreset,
  getCanvasLongestSide,
  getPresetCanvasDimensions,
  resolveCanvasDimensions,
  resolveLockedCanvasFromHeight,
  resolveLockedCanvasFromWidth
} from '../electron/renderSizing.ts'

assert.deepEqual(getPresetCanvasDimensions('horizontal', '1080p'), { width: 1080, height: 324 })
assert.deepEqual(getPresetCanvasDimensions('horizontal', '4k'), { width: 2160, height: 648 })
assert.deepEqual(getPresetCanvasDimensions('vertical', '1080p'), { width: 833, height: 1080 })
assert.deepEqual(getPresetCanvasDimensions('vertical', '4k'), { width: 1666, height: 2160 })

assert.deepEqual(resolveCanvasDimensions('horizontal', 9999), { width: 2160, height: 648 })
assert.deepEqual(resolveCanvasDimensions('vertical', 200), { width: 833, height: 1080 })

assert.deepEqual(resolveLockedCanvasFromWidth('horizontal', 1440), { width: 1440, height: 432 })
assert.deepEqual(resolveLockedCanvasFromHeight('horizontal', 432), { width: 1440, height: 432 })
assert.deepEqual(resolveLockedCanvasFromWidth('vertical', 1111), { width: 1111, height: 1440 })
assert.deepEqual(resolveLockedCanvasFromHeight('vertical', 1440), { width: 1111, height: 1440 })

assert.equal(detectCanvasPreset('horizontal', 1080, 324), '1080p')
assert.equal(detectCanvasPreset('vertical', 1666, 2160), '4k')
assert.equal(detectCanvasPreset('horizontal', 1200, 400), 'custom')

assert.equal(getCanvasLongestSide(1200, 480), 1200)
assert.equal(getCanvasLongestSide(720, 1440), 1440)
assert.equal(clampCanvasAxis(100), 240)
assert.equal(clampCanvasAxis(4096), 2160)

console.log('Render sizing tests passed.')
