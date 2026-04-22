type OverlayLayout = 'horizontal' | 'vertical'
type OverlaySizePreset = '1080p' | '1440p' | '4k' | 'custom'

const overlaySizePresetLongestSide: Record<Exclude<OverlaySizePreset, 'custom'>, number> = {
  '1080p': 1080,
  '1440p': 1440,
  '4k': 2160
}

export const lockedLongestSideBounds = {
  min: 1080,
  max: 2160
} as const

export const freeCanvasAxisBounds = {
  min: 240,
  max: 2160
} as const

const baseDimensionsByLayout: Record<OverlayLayout, { width: number; height: number }> = {
  horizontal: { width: 1800, height: 540 },
  vertical: { width: 1080, height: 1400 }
}

export function getBaseCanvasDimensions(layout: OverlayLayout) {
  return baseDimensionsByLayout[layout]
}

export function clampLockedLongestSide(longestSide: number) {
  return Math.max(
    lockedLongestSideBounds.min,
    Math.min(lockedLongestSideBounds.max, Math.round(longestSide))
  )
}

export function clampCanvasAxis(value: number) {
  return Math.max(
    freeCanvasAxisBounds.min,
    Math.min(freeCanvasAxisBounds.max, Math.round(value))
  )
}

export function resolveCanvasDimensions(layout: OverlayLayout, longestSide: number) {
  const normalizedLongestSide = clampLockedLongestSide(longestSide)
  const baseDimensions = baseDimensionsByLayout[layout]
  if (layout === 'horizontal') {
    return {
      width: normalizedLongestSide,
      height: Math.round(normalizedLongestSide * (baseDimensions.height / baseDimensions.width))
    }
  }

  return {
    width: Math.round(normalizedLongestSide * (baseDimensions.width / baseDimensions.height)),
    height: normalizedLongestSide
  }
}

export function getPresetCanvasDimensions(layout: OverlayLayout, preset: Exclude<OverlaySizePreset, 'custom'>) {
  return resolveCanvasDimensions(layout, overlaySizePresetLongestSide[preset])
}

export function getCanvasLongestSide(width: number, height: number) {
  return Math.max(width, height)
}

export function resolveLockedCanvasFromWidth(layout: OverlayLayout, width: number) {
  if (layout === 'horizontal') {
    return resolveCanvasDimensions(layout, width)
  }

  const baseDimensions = baseDimensionsByLayout[layout]
  const derivedLongestSide = Math.round(width * (baseDimensions.height / baseDimensions.width))
  return resolveCanvasDimensions(layout, derivedLongestSide)
}

export function resolveLockedCanvasFromHeight(layout: OverlayLayout, height: number) {
  if (layout === 'vertical') {
    return resolveCanvasDimensions(layout, height)
  }

  const baseDimensions = baseDimensionsByLayout[layout]
  const derivedLongestSide = Math.round(height * (baseDimensions.width / baseDimensions.height))
  return resolveCanvasDimensions(layout, derivedLongestSide)
}

export function detectCanvasPreset(layout: OverlayLayout, width: number, height: number): OverlaySizePreset {
  const normalizedWidth = Math.round(width)
  const normalizedHeight = Math.round(height)
  for (const preset of Object.keys(overlaySizePresetLongestSide) as Array<Exclude<OverlaySizePreset, 'custom'>>) {
    const presetDimensions = getPresetCanvasDimensions(layout, preset)
    if (presetDimensions.width === normalizedWidth && presetDimensions.height === normalizedHeight) {
      return preset
    }
  }

  return 'custom'
}

export function clampFreeCanvasDimensions(width: number, height: number) {
  return {
    width: clampCanvasAxis(width),
    height: clampCanvasAxis(height)
  }
}
