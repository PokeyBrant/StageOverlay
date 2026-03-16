import fs from 'node:fs'
import path from 'node:path'
import { app, nativeImage } from 'electron'
import { slugify } from './parsers'
import { getSessionMatch } from './sessionStore'
import type { OverlayExportOptions, OverlayExportResult, OverlayLayout, OverlayPreview, OverlayTheme, ScrapedMatch, ScrapedStage, ScrapedStageResult } from './types'

type ThemeConfig = {
  bgStart: string
  bgEnd: string
  accent: string
  panel: string
  text: string
  muted: string
}

const themes: Record<OverlayTheme, ThemeConfig> = {
  carbon: {
    bgStart: '#09111c',
    bgEnd: '#14273d',
    accent: '#ff9f1c',
    panel: 'rgba(255,255,255,0.08)',
    text: '#f8fafc',
    muted: '#bfd1e5'
  },
  sunset: {
    bgStart: '#2b1021',
    bgEnd: '#5b2237',
    accent: '#ffd166',
    panel: 'rgba(255,255,255,0.1)',
    text: '#fff6eb',
    muted: '#f4d8c0'
  }
}

const dimensionsByLayout: Record<OverlayLayout, { width: number; height: number }> = {
  horizontal: { width: 1800, height: 540 },
  vertical: { width: 1080, height: 1400 }
}

export function createPreview(sessionId: string, shooterId: string, stageId: string, layout: OverlayLayout, theme: OverlayTheme): OverlayPreview {
  const sessionMatch = getSessionMatch(sessionId)
  if (!sessionMatch) {
    throw new Error('Session match not found.')
  }

  const stage = sessionMatch.match.stages.find((candidate) => candidate.id === stageId)
  if (!stage) {
    throw new Error('Stage not found.')
  }

  const shooter = sessionMatch.match.shooters.find((candidate) => candidate.id === shooterId)
  if (!shooter) {
    throw new Error('Shooter not found.')
  }

  const result = stage.results.find((candidate) => candidate.shooterName === shooter.name)
  if (!result) {
    throw new Error('No stage result found for shooter.')
  }

  return {
    stageId,
    imageDataUrl: renderPngDataUrl(sessionMatch.match, stage, result, layout, theme)
  }
}

export async function exportOverlays(sessionId: string, shooterId: string, options: OverlayExportOptions): Promise<OverlayExportResult> {
  const sessionMatch = getSessionMatch(sessionId)
  if (!sessionMatch) {
    throw new Error('Session match not found.')
  }

  const shooter = sessionMatch.match.shooters.find((candidate) => candidate.id === shooterId)
  if (!shooter) {
    throw new Error('Shooter not found.')
  }

  const baseDir = path.join(
    app.getPath('documents'),
    'StageOverlayExports',
    slugify(sessionMatch.match.name),
    slugify(shooter.name)
  )
  await fs.promises.mkdir(baseDir, { recursive: true })

  const files: string[] = []
  for (const stage of sessionMatch.match.stages) {
    const result = stage.results.find((candidate) => candidate.shooterName === shooter.name)
    if (!result) continue
    const buffer = renderPngBuffer(sessionMatch.match, stage, result, options.layout, options.theme)
    const filePath = path.join(baseDir, `stage-${String(stage.order).padStart(2, '0')}.png`)
    await fs.promises.writeFile(filePath, buffer)
    files.push(filePath)
  }

  return { outputDir: baseDir, files }
}

function renderPngDataUrl(match: ScrapedMatch, stage: ScrapedStage, result: ScrapedStageResult, layout: OverlayLayout, theme: OverlayTheme) {
  const buffer = renderPngBuffer(match, stage, result, layout, theme)
  return `data:image/png;base64,${buffer.toString('base64')}`
}

function renderPngBuffer(match: ScrapedMatch, stage: ScrapedStage, result: ScrapedStageResult, layout: OverlayLayout, themeName: OverlayTheme) {
  const svg = buildSvg(match, stage, result, layout, themes[themeName])
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  const image = nativeImage.createFromDataURL(dataUrl)
  const png = image.toPNG()
  if (!png.length) {
    throw new Error('Failed to render overlay image.')
  }
  return png
}

function buildSvg(match: ScrapedMatch, stage: ScrapedStage, result: ScrapedStageResult, layout: OverlayLayout, theme: ThemeConfig) {
  const { width, height } = dimensionsByLayout[layout]
  const stats = Object.entries(result.stats).slice(0, layout === 'horizontal' ? 6 : 8)
  const placement = result.placement || 'N/A'

  const statBlocks = stats
    .map(([label, value], index) => {
      const column = layout === 'horizontal' ? index % 3 : index % 2
      const row = layout === 'horizontal' ? Math.floor(index / 3) : Math.floor(index / 2)
      const x = layout === 'horizontal' ? 880 + column * 285 : 120 + column * 420
      const y = layout === 'horizontal' ? 210 + row * 120 : 520 + row * 150
      return `
        <g transform="translate(${x}, ${y})">
          <rect width="${layout === 'horizontal' ? 245 : 360}" height="88" rx="24" fill="${theme.panel}" />
          <text x="24" y="34" font-size="22" font-family="Segoe UI, sans-serif" fill="${theme.muted}">${escapeXml(label)}</text>
          <text x="24" y="67" font-size="30" font-weight="700" font-family="Segoe UI, sans-serif" fill="${theme.text}">${escapeXml(value)}</text>
        </g>
      `
    })
    .join('')

  const topBlock = layout === 'horizontal'
    ? `
      <text x="90" y="120" font-size="34" font-family="Segoe UI, sans-serif" fill="${theme.muted}">${escapeXml(match.name)}</text>
      <text x="90" y="206" font-size="86" font-weight="800" font-family="Segoe UI, sans-serif" fill="${theme.text}">${escapeXml(stage.name)}</text>
      <text x="90" y="280" font-size="34" font-family="Segoe UI, sans-serif" fill="${theme.accent}">${escapeXml(result.shooterName)}</text>
      <g transform="translate(90, 340)">
        <rect width="360" height="116" rx="30" fill="${theme.panel}" />
        <text x="28" y="40" font-size="26" font-family="Segoe UI, sans-serif" fill="${theme.muted}">Stage Placement</text>
        <text x="28" y="88" font-size="54" font-weight="800" font-family="Segoe UI, sans-serif" fill="${theme.text}">${escapeXml(placement)}</text>
      </g>
    `
    : `
      <text x="80" y="100" font-size="28" font-family="Segoe UI, sans-serif" fill="${theme.muted}">${escapeXml(match.name)}</text>
      <text x="80" y="180" font-size="72" font-weight="800" font-family="Segoe UI, sans-serif" fill="${theme.text}">${escapeXml(stage.name)}</text>
      <text x="80" y="236" font-size="30" font-family="Segoe UI, sans-serif" fill="${theme.accent}">${escapeXml(result.shooterName)}</text>
      <g transform="translate(80, 300)">
        <rect width="920" height="140" rx="34" fill="${theme.panel}" />
        <text x="34" y="50" font-size="26" font-family="Segoe UI, sans-serif" fill="${theme.muted}">Stage Placement</text>
        <text x="34" y="105" font-size="64" font-weight="800" font-family="Segoe UI, sans-serif" fill="${theme.text}">${escapeXml(placement)}</text>
      </g>
    `

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${theme.bgStart}" />
          <stop offset="100%" stop-color="${theme.bgEnd}" />
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" rx="42" fill="url(#bg)" />
      <circle cx="${layout === 'horizontal' ? 1460 : 860}" cy="${layout === 'horizontal' ? 100 : 180}" r="${layout === 'horizontal' ? 180 : 220}" fill="${theme.accent}" opacity="0.15" />
      <circle cx="${layout === 'horizontal' ? 1680 : 220}" cy="${layout === 'horizontal' ? 420 : 1260}" r="${layout === 'horizontal' ? 140 : 200}" fill="${theme.accent}" opacity="0.10" />
      ${topBlock}
      ${statBlocks}
    </svg>
  `
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
