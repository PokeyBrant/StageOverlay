import type { OverlayLayout } from './types'

export type DecorationColorKey = 'accent' | 'muted' | 'text' | 'panel'

type Range = [number, number]

type WeightedColor = {
  color: DecorationColorKey
  weight: number
}

export type DecorationOrbSpec = {
  anchorX: number
  anchorY: number
  radius: Range
  opacity: Range
  color: DecorationColorKey
  xJitter: number
  yJitter: number
}

export type DecorationFieldSpec = {
  count: Range
  radius: Range
  opacity: Range
  ringChance: number
  minGap: number
  colorWeights: WeightedColor[]
}

export type ThemeDecorationConfig = {
  safePadding: number
  avoidPadding: number
  orbsByLayout: Record<OverlayLayout, DecorationOrbSpec[]>
  dotsByLayout: Record<OverlayLayout, DecorationFieldSpec>
}

export type DecorationRect = {
  x: number
  y: number
  width: number
  height: number
}

export type DecorationCircle = {
  cx: number
  cy: number
  r: number
  opacity: number
  colorKey: DecorationColorKey
  variant: 'fill' | 'ring'
  strokeWidth?: number
}

type DecorationParams = {
  width: number
  height: number
  layout: OverlayLayout
  config: ThemeDecorationConfig
  avoidRects: DecorationRect[]
  seed: string
}

export function buildDecorationSeed(parts: Array<string | null | undefined>) {
  const normalized = parts
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)

  return normalized.length > 0 ? normalized.join('|') : 'overlay'
}

export function generateDecorativeCircles(params: DecorationParams): DecorationCircle[] {
  const { width, height, layout, config, seed } = params
  const random = createSeededRandom(seed)
  const avoidRects = params.avoidRects.map((rect) => expandRect(rect, config.avoidPadding))
  const circles: DecorationCircle[] = []

  for (const orb of config.orbsByLayout[layout]) {
    const radius = pickRange(random, orb.radius)
    const cx = clamp(orb.anchorX * width + randomBetween(random, -orb.xJitter, orb.xJitter), config.safePadding + radius, width - config.safePadding - radius)
    const cy = clamp(orb.anchorY * height + randomBetween(random, -orb.yJitter, orb.yJitter), config.safePadding + radius, height - config.safePadding - radius)
    const candidate: DecorationCircle = {
      cx,
      cy,
      r: radius,
      opacity: pickRange(random, orb.opacity),
      colorKey: orb.color,
      variant: 'fill'
    }

    if (!intersectsAnyRect(candidate, avoidRects)) {
      circles.push(candidate)
    }
  }

  const field = config.dotsByLayout[layout]
  const dotCount = Math.round(pickRange(random, field.count))
  const targetCount = circles.length + dotCount
  let attempts = 0
  while (circles.length < targetCount && attempts < dotCount * 18) {
    attempts += 1
    const radius = pickRange(random, field.radius)
    const candidate: DecorationCircle = {
      cx: randomBetween(random, config.safePadding + radius, width - config.safePadding - radius),
      cy: randomBetween(random, config.safePadding + radius, height - config.safePadding - radius),
      r: radius,
      opacity: pickRange(random, field.opacity),
      colorKey: pickWeightedColor(random, field.colorWeights),
      variant: random() < field.ringChance ? 'ring' : 'fill',
      strokeWidth: radius <= 8 ? 1.4 : radius <= 14 ? 1.8 : 2.2
    }

    if (intersectsAnyRect(candidate, avoidRects)) {
      continue
    }

    if (circles.some((circle) => circlesOverlap(circle, candidate, field.minGap))) {
      continue
    }

    circles.push(candidate)
  }

  return circles
}

function createSeededRandom(seed: string) {
  let value = hashSeed(seed)
  return () => {
    value += 0x6d2b79f5
    let next = Math.imul(value ^ (value >>> 15), value | 1)
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61)
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}

function hashSeed(seed: string) {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function pickRange(random: () => number, range: Range) {
  return randomBetween(random, range[0], range[1])
}

function randomBetween(random: () => number, min: number, max: number) {
  if (min === max) {
    return min
  }
  return min + (max - min) * random()
}

function pickWeightedColor(random: () => number, options: WeightedColor[]) {
  const totalWeight = options.reduce((sum, option) => sum + option.weight, 0)
  let cursor = random() * totalWeight

  for (const option of options) {
    cursor -= option.weight
    if (cursor <= 0) {
      return option.color
    }
  }

  return options[options.length - 1]?.color ?? 'accent'
}

function expandRect(rect: DecorationRect, padding: number): DecorationRect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2
  }
}

function intersectsAnyRect(circle: DecorationCircle, rects: DecorationRect[]) {
  return rects.some((rect) => circleIntersectsRect(circle, rect))
}

function circleIntersectsRect(circle: DecorationCircle, rect: DecorationRect) {
  const nearestX = clamp(circle.cx, rect.x, rect.x + rect.width)
  const nearestY = clamp(circle.cy, rect.y, rect.y + rect.height)
  const dx = circle.cx - nearestX
  const dy = circle.cy - nearestY
  return dx * dx + dy * dy < circle.r * circle.r
}

function circlesOverlap(left: DecorationCircle, right: DecorationCircle, gap: number) {
  const dx = left.cx - right.cx
  const dy = left.cy - right.cy
  const minDistance = left.r + right.r + gap
  return dx * dx + dy * dy < minDistance * minDistance
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
