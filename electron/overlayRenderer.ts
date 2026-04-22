import fs from 'node:fs'
import path from 'node:path'
import { getSessionMatch } from './sessionStore.ts'
import { buildDecorationSeed, generateDecorativeCircles } from './overlayDecor.ts'
import { clampCanvasAxis, getBaseCanvasDimensions } from './renderSizing.ts'
import type {
  OverlayExportOptions,
  OverlayRenderSettings,
  OverlayExportResult,
  OverlayLayout,
  OverlayPreview,
  OverlayTheme,
  OverlayViewSelection,
  MatchData,
  MatchShooter,
  MatchStage
} from './types.ts'
import type { DecorationCircle, DecorationColorKey, DecorationRect, ThemeDecorationConfig } from './overlayDecor.ts'

type ThemeConfig = {
  bgStart: string
  bgEnd: string
  accent: string
  panel: string
  text: string
  muted: string
  decoration: ThemeDecorationConfig
}

type ThemeDefinition = {
  bgStart: string
  bgEnd: string
  accent: string
  text: string
  muted: string
  panel?: string
  primaryOrbColor: DecorationColorKey
  secondaryOrbColor: DecorationColorKey
  horizontalAnchors?: { primary: [number, number]; secondary: [number, number] }
  verticalAnchors?: { primary: [number, number]; secondary: [number, number] }
  countRange?: [number, number]
  radiusRange?: [number, number]
  ringChance?: number
  minGap?: number
  accentWeight?: number
  mutedWeight?: number
  panelWeight?: number
}

export { resolveCanvasDimensions } from './renderSizing.ts'

export const renderCanvasAxisBounds = {
  min: 240,
  max: 2160
} as const

function createThemeConfig(definition: ThemeDefinition): ThemeConfig {
  const horizontalAnchors = definition.horizontalAnchors ?? { primary: [0.84, 0.16], secondary: [0.14, 0.84] }
  const verticalAnchors = definition.verticalAnchors ?? { primary: [0.84, 0.14], secondary: [0.18, 0.88] }
  const countRange = definition.countRange ?? [16, 24]
  const radiusRange = definition.radiusRange ?? [4, 20]
  const ringChance = definition.ringChance ?? 0.34
  const minGap = definition.minGap ?? 10

  return {
    bgStart: definition.bgStart,
    bgEnd: definition.bgEnd,
    accent: definition.accent,
    panel: definition.panel ?? 'rgba(255,255,255,0.09)',
    text: definition.text,
    muted: definition.muted,
    decoration: {
      safePadding: 34,
      avoidPadding: 18,
      orbsByLayout: {
        horizontal: [
          {
            anchorX: horizontalAnchors.primary[0],
            anchorY: horizontalAnchors.primary[1],
            radius: [136, 220],
            opacity: [0.08, 0.16],
            color: definition.primaryOrbColor,
            xJitter: 44,
            yJitter: 30
          },
          {
            anchorX: horizontalAnchors.secondary[0],
            anchorY: horizontalAnchors.secondary[1],
            radius: [92, 156],
            opacity: [0.04, 0.1],
            color: definition.secondaryOrbColor,
            xJitter: 38,
            yJitter: 38
          }
        ],
        vertical: [
          {
            anchorX: verticalAnchors.primary[0],
            anchorY: verticalAnchors.primary[1],
            radius: [138, 228],
            opacity: [0.08, 0.16],
            color: definition.primaryOrbColor,
            xJitter: 40,
            yJitter: 28
          },
          {
            anchorX: verticalAnchors.secondary[0],
            anchorY: verticalAnchors.secondary[1],
            radius: [104, 180],
            opacity: [0.04, 0.1],
            color: definition.secondaryOrbColor,
            xJitter: 40,
            yJitter: 34
          }
        ]
      },
      dotsByLayout: {
        horizontal: {
          count: countRange,
          radius: radiusRange,
          opacity: [0.08, 0.24],
          ringChance,
          minGap,
          colorWeights: [
            { color: 'accent', weight: definition.accentWeight ?? 4 },
            { color: 'muted', weight: definition.mutedWeight ?? 3 },
            { color: 'panel', weight: definition.panelWeight ?? 2 },
            { color: 'text', weight: 1 }
          ]
        },
        vertical: {
          count: [countRange[0] + 2, countRange[1] + 4],
          radius: [radiusRange[0], radiusRange[1] + 2],
          opacity: [0.08, 0.24],
          ringChance: Math.min(0.5, ringChance + 0.04),
          minGap,
          colorWeights: [
            { color: 'accent', weight: definition.accentWeight ?? 4 },
            { color: 'muted', weight: definition.mutedWeight ?? 3 },
            { color: 'panel', weight: definition.panelWeight ?? 2 },
            { color: 'text', weight: 1 }
          ]
        }
      }
    }
  }
}

const themes: Record<OverlayTheme, ThemeConfig> = {
  carbon: createThemeConfig({
    bgStart: '#09111c',
    bgEnd: '#14273d',
    accent: '#ff9f1c',
    text: '#f8fafc',
    muted: '#bfd1e5',
    primaryOrbColor: 'accent',
    secondaryOrbColor: 'muted'
  }),
  sunset: createThemeConfig({
    bgStart: '#2b1021',
    bgEnd: '#5b2237',
    accent: '#ffd166',
    text: '#fff6eb',
    muted: '#f4d8c0',
    primaryOrbColor: 'accent',
    secondaryOrbColor: 'panel',
    accentWeight: 5,
    countRange: [14, 22],
    radiusRange: [5, 20],
    ringChance: 0.28
  }),
  ocean: createThemeConfig({
    bgStart: '#07243a',
    bgEnd: '#0f5c78',
    accent: '#5eead4',
    text: '#ecfeff',
    muted: '#b8f0f5',
    primaryOrbColor: 'accent',
    secondaryOrbColor: 'panel',
    horizontalAnchors: { primary: [0.88, 0.18], secondary: [0.18, 0.82] },
    verticalAnchors: { primary: [0.82, 0.12], secondary: [0.2, 0.9] }
  }),
  ember: createThemeConfig({
    bgStart: '#27120c',
    bgEnd: '#7c2d12',
    accent: '#fb923c',
    text: '#fff7ed',
    muted: '#fdc89e',
    primaryOrbColor: 'accent',
    secondaryOrbColor: 'panel',
    accentWeight: 5,
    ringChance: 0.26
  }),
  forest: createThemeConfig({
    bgStart: '#0c2016',
    bgEnd: '#1f5131',
    accent: '#86efac',
    text: '#f0fdf4',
    muted: '#c7f3d0',
    primaryOrbColor: 'accent',
    secondaryOrbColor: 'muted',
    countRange: [18, 26]
  }),
  midnight: createThemeConfig({
    bgStart: '#070b1d',
    bgEnd: '#1d2d63',
    accent: '#7dd3fc',
    text: '#eef6ff',
    muted: '#bfd4ff',
    primaryOrbColor: 'accent',
    secondaryOrbColor: 'text',
    horizontalAnchors: { primary: [0.82, 0.14], secondary: [0.9, 0.84] },
    verticalAnchors: { primary: [0.8, 0.12], secondary: [0.18, 0.9] },
    panelWeight: 3
  }),
  violet: createThemeConfig({
    bgStart: '#1d1035',
    bgEnd: '#5a2f8f',
    accent: '#c4b5fd',
    text: '#f5f3ff',
    muted: '#ddd6fe',
    primaryOrbColor: 'accent',
    secondaryOrbColor: 'panel',
    radiusRange: [5, 22],
    ringChance: 0.4
  }),
  steel: createThemeConfig({
    bgStart: '#10161f',
    bgEnd: '#334155',
    accent: '#f8fafc',
    text: '#ffffff',
    muted: '#cbd5e1',
    primaryOrbColor: 'text',
    secondaryOrbColor: 'panel',
    accentWeight: 2,
    mutedWeight: 4,
    panelWeight: 3,
    ringChance: 0.42
  }),
  rose: createThemeConfig({
    bgStart: '#3b1026',
    bgEnd: '#9f295f',
    accent: '#fda4af',
    text: '#fff1f2',
    muted: '#fecdd3',
    primaryOrbColor: 'accent',
    secondaryOrbColor: 'panel',
    countRange: [15, 24],
    ringChance: 0.3
  }),
  gold: createThemeConfig({
    bgStart: '#2a1d08',
    bgEnd: '#7c5a10',
    accent: '#fde68a',
    text: '#fffbea',
    muted: '#f7dd9c',
    primaryOrbColor: 'accent',
    secondaryOrbColor: 'panel',
    accentWeight: 5,
    radiusRange: [5, 18],
    horizontalAnchors: { primary: [0.86, 0.16], secondary: [0.16, 0.78] },
    verticalAnchors: { primary: [0.84, 0.12], secondary: [0.22, 0.88] }
  })
}

type OverlayContent = {
  modeLabel: string
  title: string
  subtitle: string
  shooterName: string
  divisionLabel: string
  showModeLabel: boolean
  titleVariant: 'default' | 'summary'
  primaryLabel: string
  primaryValue: string
  secondaryLabel: string
  secondaryValue: string
  stats: Record<string, string>
}

type SummaryCardFrame = {
  x: number
  y: number
  width: number
  height: number
  radius: number
  labelFontSize: number
  valueFontSize: number
  labelY: number
  valueY: number
  paddingX: number
  secondaryX: number
}

type StatGridFrame = {
  x: number
  y: number
  columns: number
  columnGap: number
  rowGap: number
  cardWidth: number
  cardHeight: number
  radius: number
  paddingX: number
  labelFontSize: number
  valueFontSize: number
  labelY: number
  valueY: number
  maxCards: number
}

type BasicStatBlock = {
  kind: 'default'
  label: string
  value: string
}

type GroupedStatEntry = {
  label: string
  value: string
}

type GroupedStatBlock = {
  kind: 'grouped'
  label: string
  entries: GroupedStatEntry[]
}

type DisplayStatBlock = BasicStatBlock | GroupedStatBlock

type PositionedStatBlock = {
  item: DisplayStatBlock
  x: number
  y: number
  width: number
  height: number
  row: number
  rowSpan: number
}

type TitleFrame = {
  x: number
  y: number
  width: number
  height: number
  maxFontSize: number
  minFontSize: number
  textAnchor: 'start' | 'middle'
}

type LayoutFrame = {
  title: TitleFrame
  summaryTitle: TitleFrame
  subtitleY: number
  subtitleFontSize: number
  modeLabelY: number
  shooterY: number
  divisionY: number
  contentTopY: number
  bottomMargin: number
  summaryCard: SummaryCardFrame
  statGrid: StatGridFrame
  summaryPlacement: 'sidecar' | 'stacked'
}

const framesByLayout: Record<OverlayLayout, LayoutFrame> = {
  horizontal: {
    title: {
      x: 90,
      y: 52,
      width: 1620,
      height: 84,
      maxFontSize: 86,
      minFontSize: 38,
      textAnchor: 'start'
    },
    summaryTitle: {
      x: 90,
      y: 52,
      width: 1620,
      height: 84,
      maxFontSize: 72,
      minFontSize: 38,
      textAnchor: 'start'
    },
    subtitleY: 150,
    subtitleFontSize: 28,
    modeLabelY: 120,
    shooterY: 236,
    divisionY: 278,
    contentTopY: 286,
    bottomMargin: 52,
    summaryPlacement: 'sidecar',
    summaryCard: {
      x: 90,
      y: 0,
      width: 430,
      height: 118,
      radius: 30,
      labelFontSize: 24,
      valueFontSize: 54,
      labelY: 40,
      valueY: 88,
      paddingX: 28,
      secondaryX: 226
    },
    statGrid: {
      x: 644,
      y: 0,
      columns: 4,
      columnGap: 22,
      rowGap: 22,
      cardWidth: 240,
      cardHeight: 114,
      radius: 24,
      paddingX: 22,
      labelFontSize: 24,
      valueFontSize: 36,
      labelY: 38,
      valueY: 76,
      maxCards: 8
    }
  },
  vertical: {
    title: {
      x: 80,
      y: 52,
      width: 920,
      height: 86,
      maxFontSize: 78,
      minFontSize: 34,
      textAnchor: 'start'
    },
    summaryTitle: {
      x: 80,
      y: 52,
      width: 920,
      height: 88,
      maxFontSize: 68,
      minFontSize: 34,
      textAnchor: 'start'
    },
    subtitleY: 160,
    subtitleFontSize: 28,
    modeLabelY: 104,
    shooterY: 252,
    divisionY: 300,
    contentTopY: 368,
    bottomMargin: 72,
    summaryPlacement: 'stacked',
    summaryCard: {
      x: 80,
      y: 0,
      width: 920,
      height: 156,
      radius: 34,
      labelFontSize: 24,
      valueFontSize: 60,
      labelY: 50,
      valueY: 112,
      paddingX: 34,
      secondaryX: 486
    },
    statGrid: {
      x: 80,
      y: 0,
      columns: 2,
      columnGap: 24,
      rowGap: 24,
      cardWidth: 448,
      cardHeight: 148,
      radius: 28,
      paddingX: 28,
      labelFontSize: 24,
      valueFontSize: 40,
      labelY: 44,
      valueY: 92,
      maxCards: 8
    }
  }
}

export function getThemeConfig(theme: OverlayTheme) {
  return themes[theme]
}

export function buildThemeDecorationSeed(theme: OverlayTheme, layout: OverlayLayout, backgroundSeed: string) {
  return buildDecorationSeed([theme, layout, normalizeBackgroundSeed(backgroundSeed)])
}

function normalizeBackgroundSeed(backgroundSeed: string) {
  const trimmed = backgroundSeed.trim()
  return trimmed || 'stageoverlay-default'
}

function scaleNumber(value: number, factor: number) {
  return Math.round(value * factor * 100) / 100
}

function scaleTitleFrame(frame: TitleFrame, factor: number): TitleFrame {
  return {
    ...frame,
    x: scaleNumber(frame.x, factor),
    y: scaleNumber(frame.y, factor),
    width: scaleNumber(frame.width, factor),
    height: scaleNumber(frame.height, factor),
    maxFontSize: scaleNumber(frame.maxFontSize, factor),
    minFontSize: scaleNumber(frame.minFontSize, factor)
  }
}

function scaleSummaryCardFrame(frame: SummaryCardFrame, factor: number): SummaryCardFrame {
  return {
    ...frame,
    x: scaleNumber(frame.x, factor),
    y: scaleNumber(frame.y, factor),
    width: scaleNumber(frame.width, factor),
    height: scaleNumber(frame.height, factor),
    radius: scaleNumber(frame.radius, factor),
    labelFontSize: scaleNumber(frame.labelFontSize, factor),
    valueFontSize: scaleNumber(frame.valueFontSize, factor),
    labelY: scaleNumber(frame.labelY, factor),
    valueY: scaleNumber(frame.valueY, factor),
    paddingX: scaleNumber(frame.paddingX, factor),
    secondaryX: scaleNumber(frame.secondaryX, factor)
  }
}

function scaleStatGridFrame(frame: StatGridFrame, factor: number): StatGridFrame {
  return {
    ...frame,
    x: scaleNumber(frame.x, factor),
    y: scaleNumber(frame.y, factor),
    columnGap: scaleNumber(frame.columnGap, factor),
    rowGap: scaleNumber(frame.rowGap, factor),
    cardWidth: scaleNumber(frame.cardWidth, factor),
    cardHeight: scaleNumber(frame.cardHeight, factor),
    radius: scaleNumber(frame.radius, factor),
    paddingX: scaleNumber(frame.paddingX, factor),
    labelFontSize: scaleNumber(frame.labelFontSize, factor),
    valueFontSize: scaleNumber(frame.valueFontSize, factor),
    labelY: scaleNumber(frame.labelY, factor),
    valueY: scaleNumber(frame.valueY, factor)
  }
}

function scaleLayoutFrame(frame: LayoutFrame, factor: number): LayoutFrame {
  return {
    ...frame,
    title: scaleTitleFrame(frame.title, factor),
    summaryTitle: scaleTitleFrame(frame.summaryTitle, factor),
    subtitleY: scaleNumber(frame.subtitleY, factor),
    subtitleFontSize: scaleNumber(frame.subtitleFontSize, factor),
    modeLabelY: scaleNumber(frame.modeLabelY, factor),
    shooterY: scaleNumber(frame.shooterY, factor),
    divisionY: scaleNumber(frame.divisionY, factor),
    contentTopY: scaleNumber(frame.contentTopY, factor),
    bottomMargin: scaleNumber(frame.bottomMargin, factor),
    summaryCard: scaleSummaryCardFrame(frame.summaryCard, factor),
    statGrid: scaleStatGridFrame(frame.statGrid, factor)
  }
}

function scaleRange(range: [number, number], factor: number): [number, number] {
  return [scaleNumber(range[0], factor), scaleNumber(range[1], factor)]
}

function scaleThemeDecorationConfig(config: ThemeDecorationConfig, factor: number): ThemeDecorationConfig {
  return {
    safePadding: scaleNumber(config.safePadding, factor),
    avoidPadding: scaleNumber(config.avoidPadding, factor),
    orbsByLayout: {
      horizontal: config.orbsByLayout.horizontal.map((orb) => ({
        ...orb,
        radius: scaleRange(orb.radius, factor),
        xJitter: scaleNumber(orb.xJitter, factor),
        yJitter: scaleNumber(orb.yJitter, factor)
      })),
      vertical: config.orbsByLayout.vertical.map((orb) => ({
        ...orb,
        radius: scaleRange(orb.radius, factor),
        xJitter: scaleNumber(orb.xJitter, factor),
        yJitter: scaleNumber(orb.yJitter, factor)
      }))
    },
    dotsByLayout: {
      horizontal: {
        ...config.dotsByLayout.horizontal,
        radius: scaleRange(config.dotsByLayout.horizontal.radius, factor),
        minGap: scaleNumber(config.dotsByLayout.horizontal.minGap, factor)
      },
      vertical: {
        ...config.dotsByLayout.vertical,
        radius: scaleRange(config.dotsByLayout.vertical.radius, factor),
        minGap: scaleNumber(config.dotsByLayout.vertical.minGap, factor)
      }
    }
  }
}

export async function loadBackgroundImageDataUrl(backgroundImagePath?: string | null) {
  const targetPath = backgroundImagePath?.trim()
  if (!targetPath) {
    return null
  }

  const extension = path.extname(targetPath).toLowerCase()
  const mimeType = extension === '.png'
    ? 'image/png'
    : extension === '.jpg' || extension === '.jpeg'
      ? 'image/jpeg'
      : extension === '.webp'
        ? 'image/webp'
        : extension === '.svg'
          ? 'image/svg+xml'
          : null

  if (!mimeType) {
    throw new Error('Unsupported background image format. Choose PNG, JPG, WEBP, or SVG.')
  }

  const fileBuffer = await fs.promises.readFile(targetPath)
  return `data:${mimeType};base64,${fileBuffer.toString('base64')}`
}

export async function createPreview(sessionId: string, shooterId: string, selection: OverlayViewSelection, settings: OverlayRenderSettings): Promise<OverlayPreview> {
  const sessionMatch = getSessionMatch(sessionId)
  if (!sessionMatch) {
    throw new Error('Session match not found.')
  }

  const shooter = sessionMatch.match.shooters.find((candidate) => candidate.id === shooterId)
  if (!shooter) {
    throw new Error('Shooter not found.')
  }

  const content = buildOverlayContent(sessionMatch.match, shooter, selection)

  return {
    selectionId: toSelectionId(selection),
    imageDataUrl: await renderPngDataUrl(content, settings)
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

  const baseDir = options.outputDir?.trim()
  if (!baseDir) {
    throw new Error('Export folder not selected.')
  }
  await fs.promises.mkdir(baseDir, { recursive: true })

  const selections = options.mode === 'single'
    ? options.selection ? [options.selection] : []
    : [
        { kind: 'match-summary' as const },
        ...sessionMatch.match.stages.map((stage) => ({
          kind: 'stage-summary' as const,
          stageId: stage.id
        }))
      ]

  if (selections.length === 0) {
    throw new Error('No overlay selected for export.')
  }

  const files: string[] = []
  for (const selection of selections) {
    const buffer = await renderPngBuffer(
      buildOverlayContent(sessionMatch.match, shooter, selection),
      options
    )
    const filePath = path.join(baseDir, `${toSelectionFileName(selection)}.png`)
    await fs.promises.writeFile(filePath, buffer)
    files.push(filePath)
  }

  return { outputDir: baseDir, files }
}

async function renderPngDataUrl(content: OverlayContent, settings: OverlayRenderSettings) {
  const buffer = await renderPngBuffer(content, settings)
  return `data:image/png;base64,${buffer.toString('base64')}`
}

async function renderPngBuffer(content: OverlayContent, settings: OverlayRenderSettings) {
  const { BrowserWindow } = await import('electron')
  const normalizedSettings = {
    ...settings,
    backgroundSeed: normalizeBackgroundSeed(settings.backgroundSeed),
    canvasWidth: clampCanvasAxis(settings.canvasWidth),
    canvasHeight: clampCanvasAxis(settings.canvasHeight)
  }
  const backgroundImageDataUrl = await loadBackgroundImageDataUrl(normalizedSettings.backgroundImagePath)
  const svg = buildSvg(content, normalizedSettings, backgroundImageDataUrl)
  const { canvasWidth: width, canvasHeight: height } = normalizedSettings
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden;">${svg}</body></html>`
  const window = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000'
  })
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await window.webContents.executeJavaScript(
      "document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : Promise.resolve(true)",
      true
    )
    const image = await window.webContents.capturePage()
    const png = image.toPNG()
    if (png.length) {
      return png
    }
  } finally {
    window.destroy()
  }

  throw new Error('Failed to render overlay image.')
}

function buildSvg(content: OverlayContent, settings: OverlayRenderSettings, backgroundImageDataUrl: string | null) {
  const { layout, theme: themeName, canvasWidth, canvasHeight, backgroundSeed } = settings
  const width = clampCanvasAxis(canvasWidth)
  const height = clampCanvasAxis(canvasHeight)
  const theme = themes[themeName]
  const baseDimensions = getBaseCanvasDimensions(layout)
  const scaleFactor = Math.min(width / baseDimensions.width, height / baseDimensions.height)
  const frame = scaleLayoutFrame(framesByLayout[layout], scaleFactor)
  const decorationConfig = scaleThemeDecorationConfig(theme.decoration, scaleFactor)
  const titleFrame = content.titleVariant === 'summary' ? frame.summaryTitle : frame.title
  const stats = buildDisplayStats(content.stats, frame.statGrid.maxCards)
  const contentFrames = resolveContentFrames(frame, width, height, stats)
  const positionedStats = positionStatBlocks(stats, contentFrames.statGrid)
  const leftColumnWidth = contentFrames.summaryCard.width
  const shooterText = buildFittedText(content.shooterName, {
    x: frame.title.x,
    y: frame.shooterY,
    maxWidth: leftColumnWidth,
    maxFontSize: layout === 'horizontal' ? 52 : 48,
    minFontSize: layout === 'horizontal' ? 30 : 28,
    fontWeight: '500',
    fill: theme.accent
  })
  const divisionText = buildFittedText(`Division: ${content.divisionLabel}`, {
    x: frame.title.x,
    y: frame.divisionY,
    maxWidth: leftColumnWidth,
    maxFontSize: layout === 'horizontal' ? 28 : 30,
    minFontSize: 20,
    fill: theme.muted
  })

  const statBlocks = buildStatBlocks(positionedStats.blocks, contentFrames.statGrid, theme)
  const summaryBlock = buildSummaryBlock(content, contentFrames.summaryCard, theme)
  const subtitleBlock = buildSubtitleText(content.subtitle, frame, theme)
  const backgroundDecor = backgroundImageDataUrl
    ? ''
    : buildBackgroundDecorations(
        width,
        height,
        layout,
        theme,
        decorationConfig,
        frame,
        contentFrames,
        positionedStats.blocks,
        titleFrame,
        buildThemeDecorationSeed(themeName, layout, backgroundSeed)
      )
  const cornerRadius = roundSvg(42 * scaleFactor)
  const backgroundLayer = backgroundImageDataUrl
    ? `
      <rect width="${width}" height="${height}" rx="${cornerRadius}" fill="${theme.bgStart}" />
      <image href="${backgroundImageDataUrl}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#canvas-clip)" />
      <rect width="${width}" height="${height}" rx="${cornerRadius}" fill="${theme.bgStart}" opacity="0.30" />
      <rect width="${width}" height="${height}" rx="${cornerRadius}" fill="url(#bg)" opacity="0.18" />
    `
    : `<rect width="${width}" height="${height}" rx="${cornerRadius}" fill="url(#bg)" />`

  const topBlock = layout === 'horizontal'
    ? `
      ${content.showModeLabel ? `<text x="${frame.title.x}" y="${frame.modeLabelY}" font-size="34" font-family="Segoe UI, sans-serif" fill="${theme.muted}">${escapeXml(content.modeLabel)}</text>` : ''}
      ${buildTitleText(content.title, titleFrame, theme)}
      ${subtitleBlock}
      ${shooterText}
      ${divisionText}
      ${summaryBlock}
    `
    : `
      ${content.showModeLabel ? `<text x="${frame.title.x}" y="${frame.modeLabelY}" font-size="28" font-family="Segoe UI, sans-serif" fill="${theme.muted}">${escapeXml(content.modeLabel)}</text>` : ''}
      ${buildTitleText(content.title, titleFrame, theme)}
      ${subtitleBlock}
      ${shooterText}
      ${divisionText}
      ${summaryBlock}
    `

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <clipPath id="canvas-clip">
          <rect width="${width}" height="${height}" rx="${cornerRadius}" />
        </clipPath>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${theme.bgStart}" />
          <stop offset="100%" stop-color="${theme.bgEnd}" />
        </linearGradient>
      </defs>
      ${backgroundLayer}
      ${backgroundDecor}
      ${topBlock}
      ${statBlocks}
    </svg>
  `
}

function resolveContentFrames(frame: LayoutFrame, canvasWidth: number, canvasHeight: number, stats: DisplayStatBlock[]) {
  if (frame.summaryPlacement === 'stacked') {
    const summaryCard = { ...frame.summaryCard, y: frame.contentTopY }
    return {
      summaryCard,
      statGrid: {
        ...frame.statGrid,
        y: summaryCard.y + summaryCard.height + frame.statGrid.rowGap
      }
    }
  }

  const safeLeft = frame.title.x
  const safeRight = canvasWidth - frame.title.x
  const safeBottom = canvasHeight - frame.bottomMargin
  const interZoneGap = Math.max(18, frame.statGrid.rowGap)
  const summaryY = safeBottom - frame.summaryCard.height
  const originGridLayout = positionStatBlocks(stats, { ...frame.statGrid, y: 0 })
  const gridHeight = originGridLayout.maxBottom
  const summaryRight = frame.summaryCard.x + frame.summaryCard.width

  let gridX = frame.statGrid.x
  const rightOverflow = originGridLayout.maxRight - safeRight
  if (rightOverflow > 0) {
    gridX -= rightOverflow
  }
  const shiftedLeft = originGridLayout.minLeft + (gridX - frame.statGrid.x)
  if (shiftedLeft < safeLeft) {
    gridX += safeLeft - shiftedLeft
  }

  const overlapsSummaryHorizontally = !(gridX >= summaryRight + interZoneGap || gridX + originGridLayout.maxRight - originGridLayout.minLeft <= frame.summaryCard.x - interZoneGap)
  const maxGridBottom = overlapsSummaryHorizontally ? summaryY - interZoneGap : safeBottom
  const clearsTextColumn = gridX >= summaryRight + interZoneGap
  const headerBandBottom = frame.subtitleY + frame.subtitleFontSize + Math.max(18, Math.floor(interZoneGap * 0.8))
  const textBandBottom = frame.divisionY + Math.max(22, Math.floor(interZoneGap * 0.9))
  const preferredGridY = clearsTextColumn ? headerBandBottom : textBandBottom
  const resolvedGridY = Math.max(frame.subtitleY + 8, Math.min(preferredGridY, maxGridBottom - gridHeight))
  const groupedBlock = originGridLayout.blocks.find((block) => block.item.kind === 'grouped')
  const alignedSummaryCard = clearsTextColumn
    ? {
        ...frame.summaryCard,
        y: groupedBlock
          ? resolvedGridY + groupedBlock.y + Math.max(0, Math.round((groupedBlock.height - frame.summaryCard.height) / 2))
          : summaryY
      }
    : { ...frame.summaryCard, y: summaryY }

  return {
    summaryCard: alignedSummaryCard,
    statGrid: {
      ...frame.statGrid,
      x: gridX,
      y: resolvedGridY
    }
  }
}

function buildSummaryBlock(content: OverlayContent, frame: SummaryCardFrame, theme: ThemeConfig) {
  const dynamicLabelY = Math.max(frame.labelY, Math.round(frame.height * 0.34))
  const dynamicValueY = Math.min(frame.height - 22, Math.round(frame.height * 0.76))
  return `
    <g transform="translate(${frame.x}, ${frame.y})">
      <rect width="${frame.width}" height="${frame.height}" rx="${frame.radius}" fill="${theme.panel}" />
      <text x="${frame.paddingX}" y="${dynamicLabelY}" font-size="${frame.labelFontSize}" font-family="Segoe UI, sans-serif" fill="${theme.muted}">${escapeXml(content.primaryLabel)}</text>
      <text x="${frame.paddingX}" y="${dynamicValueY}" font-size="${frame.valueFontSize}" font-weight="800" font-family="Segoe UI, sans-serif" fill="${theme.text}">${escapeXml(content.primaryValue)}</text>
      <text x="${frame.secondaryX}" y="${dynamicLabelY}" font-size="${frame.labelFontSize}" font-family="Segoe UI, sans-serif" fill="${theme.muted}">${escapeXml(content.secondaryLabel)}</text>
      <text x="${frame.secondaryX}" y="${dynamicValueY}" font-size="${frame.valueFontSize}" font-weight="800" font-family="Segoe UI, sans-serif" fill="${theme.text}">${escapeXml(content.secondaryValue)}</text>
    </g>
  `
}

function buildSubtitleText(subtitle: string, frame: LayoutFrame, theme: ThemeConfig) {
  return `<text x="${frame.title.x}" y="${frame.subtitleY}" font-size="${frame.subtitleFontSize}" font-family="Segoe UI, sans-serif" fill="${theme.muted}">${escapeXml(subtitle)}</text>`
}

function buildStatBlocks(blocks: PositionedStatBlock[], frame: StatGridFrame, theme: ThemeConfig) {
  return blocks
    .map(({ item, x, y, width, height }) => {
      if (item.kind === 'grouped') {
        return buildGroupedStatBlock(item, x, y, width, height, frame, theme)
      }

      const labelText = buildFittedText(item.label, {
        x: frame.paddingX,
        y: frame.labelY,
        maxWidth: width - frame.paddingX * 2,
        maxFontSize: frame.labelFontSize,
        minFontSize: 16,
        fill: theme.muted
      })
      const valueText = buildFittedText(item.value, {
        x: frame.paddingX,
        y: frame.valueY,
        maxWidth: width - frame.paddingX * 2,
        maxFontSize: frame.valueFontSize,
        minFontSize: 18,
        fontWeight: '700',
        fill: theme.text
      })

      return `
        <g transform="translate(${x}, ${y})">
          <rect width="${width}" height="${height}" rx="${frame.radius}" fill="${theme.panel}" />
          ${labelText}
          ${valueText}
        </g>
      `
    })
    .join('')
}

function buildBackgroundDecorations(
  width: number,
  height: number,
  layout: OverlayLayout,
  theme: ThemeConfig,
  decorationConfig: ThemeDecorationConfig,
  frame: LayoutFrame,
  contentFrames: { summaryCard: SummaryCardFrame; statGrid: StatGridFrame },
  positionedBlocks: PositionedStatBlock[],
  titleFrame: TitleFrame,
  decorationSeed: string
) {
  const statBounds = positionedBlocks.length > 0
    ? {
        x: Math.min(...positionedBlocks.map((block) => block.x)),
        y: Math.min(...positionedBlocks.map((block) => block.y)),
        width: Math.max(...positionedBlocks.map((block) => block.x + block.width)) - Math.min(...positionedBlocks.map((block) => block.x)),
        height: Math.max(...positionedBlocks.map((block) => block.y + block.height)) - Math.min(...positionedBlocks.map((block) => block.y))
      }
    : { x: contentFrames.statGrid.x, y: contentFrames.statGrid.y, width: 0, height: 0 }

  const avoidRects: DecorationRect[] = [
    {
      x: frame.title.x - 24,
      y: titleFrame.y - 28,
      width: titleFrame.width + 48,
      height: frame.subtitleY - titleFrame.y + frame.subtitleFontSize + 40
    },
    {
      x: frame.title.x - 20,
      y: frame.shooterY - 40,
      width: Math.min(width - frame.title.x - 40, contentFrames.summaryCard.width),
      height: frame.divisionY - frame.shooterY + 90
    },
    {
      x: contentFrames.summaryCard.x,
      y: contentFrames.summaryCard.y,
      width: contentFrames.summaryCard.width,
      height: contentFrames.summaryCard.height
    }
  ]

  if (statBounds.width > 0 && statBounds.height > 0) {
    avoidRects.push(statBounds)
  }

  return generateDecorativeCircles({
    width,
    height,
    layout,
    config: decorationConfig,
    avoidRects,
    seed: decorationSeed
  })
    .map((circle) => buildDecorationCircle(circle, theme))
    .join('')
}

function buildDecorationCircle(circle: DecorationCircle, theme: ThemeConfig) {
  const color = colorForDecoration(circle.colorKey, theme)
  if (circle.variant === 'ring') {
    return `<circle cx="${roundSvg(circle.cx)}" cy="${roundSvg(circle.cy)}" r="${roundSvg(circle.r)}" fill="none" stroke="${color}" stroke-width="${roundSvg(circle.strokeWidth ?? 1.6)}" opacity="${circle.opacity.toFixed(3)}" />`
  }

  return `<circle cx="${roundSvg(circle.cx)}" cy="${roundSvg(circle.cy)}" r="${roundSvg(circle.r)}" fill="${color}" opacity="${circle.opacity.toFixed(3)}" />`
}

function colorForDecoration(colorKey: DecorationColorKey, theme: ThemeConfig) {
  switch (colorKey) {
    case 'accent':
      return theme.accent
    case 'muted':
      return theme.muted
    case 'text':
      return theme.text
    case 'panel':
      return theme.panel
  }
}

function roundSvg(value: number) {
  return Number(value.toFixed(2))
}

function buildGroupedStatBlock(item: GroupedStatBlock, x: number, y: number, width: number, height: number, frame: StatGridFrame, theme: ThemeConfig) {
  const innerPadding = frame.paddingX
  const headerY = Math.max(28, frame.labelY - 4)
  const labelsY = headerY + 26
  const valuesY = height - 16
  const entryLabelFontSize = Math.max(18, frame.labelFontSize - 2)
  const entryValueFontSize = Math.max(22, frame.valueFontSize - 4)

  return `
    <g transform="translate(${x}, ${y})">
      <rect width="${width}" height="${height}" rx="${frame.radius}" fill="${theme.panel}" />
      <text x="${innerPadding}" y="${headerY}" font-size="${frame.labelFontSize}" font-family="Segoe UI, sans-serif" fill="${theme.muted}">${escapeXml(item.label)}</text>
      ${buildGroupedStatRow(item.entries, innerPadding, width - innerPadding * 2, labelsY, valuesY, entryLabelFontSize, entryValueFontSize, theme)}
    </g>
  `
}

function buildGroupedStatRow(entries: GroupedStatEntry[], x: number, rowWidth: number, labelsY: number, valuesY: number, labelFontSize: number, valueFontSize: number, theme: ThemeConfig) {
  if (entries.length === 0) {
    return ''
  }

  const slotWidth = rowWidth / entries.length
  return entries.map((entry, index) => {
    const centerX = x + slotWidth * index + slotWidth / 2
    const maxSlotWidth = Math.max(40, slotWidth - 8)
    const labelText = buildFittedText(entry.label, {
      x: centerX,
      y: labelsY,
      maxWidth: maxSlotWidth,
      maxFontSize: labelFontSize,
      minFontSize: 14,
      anchor: 'middle',
      fill: theme.muted
    })
    const valueText = buildFittedText(entry.value, {
      x: centerX,
      y: valuesY,
      maxWidth: maxSlotWidth,
      maxFontSize: valueFontSize,
      minFontSize: 16,
      anchor: 'middle',
      fontWeight: '700',
      fill: theme.text
    })
    return `
      ${labelText}
      ${valueText}
    `
  }).join('')
}

function positionStatBlocks(stats: DisplayStatBlock[], frame: StatGridFrame) {
  const occupied = new Set<string>()
  const rawBlocks: PositionedStatBlock[] = []

  for (const item of stats) {
    const span = getStatSpan(item, frame)
    const placement = findStatPlacement(occupied, frame.columns, span.colSpan, span.rowSpan)
    markStatPlacement(occupied, placement.row, placement.column, span.colSpan, span.rowSpan)

    rawBlocks.push({
      item,
      x: frame.x + placement.column * (frame.cardWidth + frame.columnGap),
      y: frame.y + placement.row * (frame.cardHeight + frame.rowGap),
      width: frame.cardWidth * span.colSpan + frame.columnGap * (span.colSpan - 1),
      height: frame.cardHeight * span.rowSpan + frame.rowGap * (span.rowSpan - 1),
      row: placement.row,
      rowSpan: span.rowSpan
    })
  }

  const blocks = stretchDefaultRows(rawBlocks, frame)

  const rowCount = blocks.reduce((max, block) => Math.max(max, block.row + block.rowSpan), 0)
  const minLeft = blocks.reduce((min, block) => Math.min(min, block.x), Number.POSITIVE_INFINITY)
  const maxRight = blocks.reduce((max, block) => Math.max(max, block.x + block.width), 0)
  const maxBottom = blocks.reduce((max, block) => Math.max(max, block.y + block.height), 0)
  return {
    blocks,
    rowCount,
    minLeft: Number.isFinite(minLeft) ? minLeft : frame.x,
    maxRight,
    maxBottom
  }
}

function stretchDefaultRows(blocks: PositionedStatBlock[], frame: StatGridFrame) {
  const totalGridWidth = frame.cardWidth * frame.columns + frame.columnGap * (frame.columns - 1)
  const rows = new Map<number, PositionedStatBlock[]>()

  blocks.forEach((block) => {
    if (!rows.has(block.row)) {
      rows.set(block.row, [])
    }
    rows.get(block.row)?.push(block)
  })

  return blocks.map((block) => {
    const rowBlocks = rows.get(block.row) ?? []
    const isStretchableRow = rowBlocks.length > 1 && rowBlocks.every((candidate) => candidate.item.kind === 'default' && candidate.rowSpan === 1)
    if (!isStretchableRow) {
      return block
    }

    const orderedRow = [...rowBlocks].sort((left, right) => left.x - right.x)
    const index = orderedRow.findIndex((candidate) => candidate === block)
    const stretchedWidth = (totalGridWidth - frame.columnGap * (orderedRow.length - 1)) / orderedRow.length
    return {
      ...block,
      x: frame.x + index * (stretchedWidth + frame.columnGap),
      width: stretchedWidth
    }
  })
}

function getStatSpan(item: DisplayStatBlock, frame: StatGridFrame) {
  if (item.kind !== 'grouped') {
    return { colSpan: 1, rowSpan: 1 }
  }

  return {
    colSpan: frame.columns,
    rowSpan: 1
  }
}

function findStatPlacement(occupied: Set<string>, columns: number, colSpan: number, rowSpan: number) {
  let row = 0

  while (true) {
    for (let column = 0; column <= columns - colSpan; column += 1) {
      if (canPlaceStat(occupied, row, column, colSpan, rowSpan)) {
        return { row, column }
      }
    }

    row += 1
  }
}

function canPlaceStat(occupied: Set<string>, row: number, column: number, colSpan: number, rowSpan: number) {
  for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < colSpan; columnOffset += 1) {
      if (occupied.has(`${row + rowOffset}:${column + columnOffset}`)) {
        return false
      }
    }
  }

  return true
}

function markStatPlacement(occupied: Set<string>, row: number, column: number, colSpan: number, rowSpan: number) {
  for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < colSpan; columnOffset += 1) {
      occupied.add(`${row + rowOffset}:${column + columnOffset}`)
    }
  }
}

function buildDisplayStats(stats: Record<string, string>, maxCards: number): DisplayStatBlock[] {
  const orderedEntries = Object.entries(stats)
  const filteredEntries = orderedEntries.filter(([label]) => !isHiddenDisplayStat(label))

  const groupedEntriesByKey = new Map<string, GroupedStatEntry>()
  for (const groupedLabel of groupedStatOrder) {
    groupedEntriesByKey.set(groupedLabel, { label: groupedLabel, value: 'N/A' })
  }

  let firstGroupedIndex = -1
  const remainingEntries: Array<[string, string]> = []
  filteredEntries.forEach(([label, value], index) => {
    const groupedLabel = toGroupedStatLabel(label)
    if (groupedLabel) {
      if (firstGroupedIndex === -1) {
        firstGroupedIndex = index
      }
      groupedEntriesByKey.set(groupedLabel, {
        label: groupedLabel,
        value: value || 'N/A'
      })
      return
    }

    remainingEntries.push([label, value])
  })

  const basicBlocks = remainingEntries.map(([label, value]) => ({
    kind: 'default' as const,
    label,
    value
  }))

  const groupedBlock = firstGroupedIndex === -1 ? [] : [{
    kind: 'grouped' as const,
    label: 'Hits / Penalties',
    entries: groupedStatOrder.map((label) => groupedEntriesByKey.get(label) ?? { label, value: 'N/A' })
  }]

  if (firstGroupedIndex === -1) {
    return basicBlocks.slice(0, maxCards)
  }

  const insertAt = Math.min(firstGroupedIndex, basicBlocks.length)
  return [
    ...basicBlocks.slice(0, insertAt),
    ...groupedBlock,
    ...basicBlocks.slice(insertAt)
  ].slice(0, maxCards)
}

function buildTitleText(title: string, frame: TitleFrame, theme: ThemeConfig) {
  const { fontSize, textLength, textX } = fitTitleText(title, frame)
  const centerY = frame.y + frame.height / 2
  const textLengthAttribute = textLength ? ` textLength="${textLength}" lengthAdjust="spacingAndGlyphs"` : ''
  const anchorAttribute = frame.textAnchor === 'middle' ? ' text-anchor="middle"' : ''

  return `<text x="${textX}" y="${centerY}" font-size="${fontSize}" font-weight="800" font-family="Segoe UI, sans-serif" dominant-baseline="middle"${anchorAttribute} fill="${theme.text}"${textLengthAttribute}>${escapeXml(title)}</text>`
}

type FittedTextOptions = {
  x: number
  y: number
  maxWidth: number
  maxFontSize: number
  minFontSize: number
  fill: string
  anchor?: 'start' | 'middle'
  fontWeight?: string
}

function buildFittedText(text: string, options: FittedTextOptions) {
  const { fontSize, textLength } = fitInlineText(text, options.maxWidth, options.maxFontSize, options.minFontSize)
  const anchor = options.anchor === 'middle' ? ' text-anchor="middle"' : ''
  const weight = options.fontWeight ? ` font-weight="${options.fontWeight}"` : ''
  const textLengthAttribute = textLength ? ` textLength="${textLength}" lengthAdjust="spacingAndGlyphs"` : ''
  return `<text x="${options.x}" y="${options.y}" font-size="${fontSize}"${weight} font-family="Segoe UI, sans-serif"${anchor} fill="${options.fill}"${textLengthAttribute}>${escapeXml(text)}</text>`
}

function fitInlineText(text: string, maxWidth: number, maxFontSize: number, minFontSize: number) {
  const normalized = text.trim()
  let fontSize = maxFontSize
  while (fontSize > minFontSize && estimateTitleWidth(normalized, fontSize) > maxWidth) {
    fontSize -= 1
  }

  const finalWidth = estimateTitleWidth(normalized, fontSize)
  return {
    fontSize,
    textLength: finalWidth > maxWidth ? maxWidth : null
  }
}

function fitTitleText(title: string, frame: TitleFrame) {
  const normalizedTitle = title.trim()
  let fontSize = frame.maxFontSize

  while (fontSize > frame.minFontSize && estimateTitleWidth(normalizedTitle, fontSize) > frame.width) {
    fontSize -= 1
  }

  const finalWidth = estimateTitleWidth(normalizedTitle, fontSize)
  return {
    fontSize,
    textLength: finalWidth > frame.width ? frame.width : null,
    textX: frame.textAnchor === 'middle' ? frame.x + frame.width / 2 : frame.x
  }
}

function estimateTitleWidth(title: string, fontSize: number) {
  let width = 0
  for (const character of title) {
    width += measureCharacterWidth(character)
  }
  return width * fontSize
}

function measureCharacterWidth(character: string) {
  if (character === ' ') return 0.33
  if (/[.,:;'|!]/.test(character)) return 0.24
  if (/[`]/.test(character)) return 0.28
  if (/[-_/()]/.test(character)) return 0.34
  if (/[ilIjtfr]/.test(character)) return 0.36
  if (/[mwMW@#%&QOGD]/.test(character)) return 0.88
  if (/[A-Z]/.test(character)) return 0.7
  if (/[0-9]/.test(character)) return 0.62
  return 0.56
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildOverlayContent(match: MatchData, shooter: MatchShooter, selection: OverlayViewSelection): OverlayContent {
  const summary = findMatchResult(match, shooter)

  if (selection.kind === 'match-summary') {
    return {
      modeLabel: '',
      title: match.name,
      subtitle: 'Match Summary',
      shooterName: shooter.name,
      divisionLabel: shooter.division || 'Unknown Division',
      showModeLabel: false,
      titleVariant: 'summary',
      primaryLabel: 'Division',
      primaryValue: summary.divisionPlacement || 'N/A',
      secondaryLabel: 'Overall',
      secondaryValue: summary.overallPlacement || 'N/A',
      stats: buildMatchSummaryStats(summary.stats, summary.divisionStats)
    }
  }

  const stage = match.stages.find((candidate) => candidate.id === selection.stageId)
  if (!stage) {
    throw new Error('Stage not found.')
  }

  const result = stage.results.find((candidate) => candidate.shooterName === shooter.name)
  if (!result) {
    throw new Error('No stage result found for shooter.')
  }

  return {
    modeLabel: '',
    title: match.name,
    subtitle: formatStageSubtitle(stage),
    shooterName: shooter.name,
    divisionLabel: shooter.division || result.division || 'Unknown Division',
    showModeLabel: false,
    titleVariant: 'default',
    primaryLabel: 'Division',
    primaryValue: result.divisionPlacement || 'N/A',
    secondaryLabel: 'Overall',
    secondaryValue: result.overallPlacement || 'N/A',
    stats: buildStageSummaryStats(result.stats, result.divisionStats)
  }
}

function buildComparisonStats(overallStats: Record<string, string>, divisionStats?: Record<string, string> | null) {
  const divisionFirstStats = { ...(divisionStats ?? overallStats) }
  if (!divisionStats) {
    return divisionFirstStats
  }

  for (const comparableLabel of comparableStatLabels) {
    const divisionKey = findComparableStatKey(divisionFirstStats, comparableLabel)
    const overallKey = findComparableStatKey(overallStats, comparableLabel)
    if (!divisionKey || !overallKey) {
      continue
    }

    const divisionValue = divisionFirstStats[divisionKey]
    const overallValue = overallStats[overallKey]
    if (!divisionValue || !overallValue || divisionValue === overallValue) {
      continue
    }

    divisionFirstStats[divisionKey] = `${divisionValue} (${overallValue})`
  }

  return divisionFirstStats
}

function buildMatchSummaryStats(overallStats: Record<string, string>, divisionStats?: Record<string, string> | null) {
  return reorderStats(buildComparisonStats(overallStats, divisionStats), [
    ['%', 'psbl', '%psbl', 'percent'],
    ['time'],
    ['pts', 'matchpoints', 'points']
  ])
}

function buildStageSummaryStats(overallStats: Record<string, string>, divisionStats?: Record<string, string> | null) {
  const orderedStageStats: Record<string, string> = {
    '%': buildStageComparisonValue(overallStats, divisionStats, ['%'], true),
    HF: buildStageComparisonValue(overallStats, divisionStats, ['hf', 'hitfactor'], false),
    Time: buildStageComparisonValue(overallStats, divisionStats, ['time'], true),
    'Pts / Stg Pts': `${buildStageComparisonValue(overallStats, divisionStats, ['pts'], true)} / ${buildStageComparisonValue(overallStats, divisionStats, ['stgpts', 'stagepoints'], false)}`
  }

  const consumedKeys = new Set([
    ...findStatKeys(overallStats, ['%', 'pts', 'stgpts', 'stagepoints', 'hf', 'hitfactor', 'time']),
    ...findStatKeys(divisionStats ?? {}, ['%', 'pts', 'stgpts', 'stagepoints', 'hf', 'hitfactor', 'time'])
  ].map((key) => normalizeStatKey(key)))

  const stageFirstStats = divisionStats ?? overallStats
  for (const [label, value] of Object.entries(stageFirstStats)) {
    const normalized = normalizeStatKey(label)
    if (consumedKeys.has(normalized) || isHiddenDisplayStat(label)) {
      continue
    }
    orderedStageStats[label] = value
  }

  return orderedStageStats
}

function buildStageComparisonValue(
  overallStats: Record<string, string>,
  divisionStats: Record<string, string> | null | undefined,
  aliases: string[],
  includeComparison: boolean
) {
  const overallKey = findStatKey(overallStats, aliases)
  const divisionKey = findStatKey(divisionStats ?? {}, aliases)
  const primaryValue = divisionKey
    ? divisionStats?.[divisionKey]
    : overallKey
      ? overallStats[overallKey]
      : null

  if (!primaryValue) {
    return 'N/A'
  }

  if (!includeComparison || !divisionStats || !overallKey || !divisionKey) {
    return primaryValue
  }

  const overallValue = overallStats[overallKey]
  if (!overallValue || overallValue === primaryValue) {
    return primaryValue
  }

  return `${primaryValue} (${overallValue})`
}

function findComparableStatKey(stats: Record<string, string>, targetLabel: ComparableStatLabel) {
  const matchingKeys = Object.keys(stats).filter((label) => toComparableStatLabel(label) === targetLabel)
  if (matchingKeys.length === 0) {
    return null
  }

  if (targetLabel === 'percentage') {
    return matchingKeys.find((label) => normalizeStatKey(label) === '%')
      ?? matchingKeys.find((label) => normalizeStatKey(label) === 'psbl')
      ?? matchingKeys.find((label) => normalizeStatKey(label) === '%psbl')
      ?? matchingKeys[0]
  }

  return matchingKeys[0]
}

function reorderStats(stats: Record<string, string>, preferredAliasGroups: string[][]) {
  const reordered: Record<string, string> = {}
  const consumedKeys = new Set<string>()

  for (const aliases of preferredAliasGroups) {
    const key = findStatKey(stats, aliases)
    if (!key || consumedKeys.has(key)) {
      continue
    }
    reordered[key] = stats[key]!
    consumedKeys.add(key)
  }

  for (const [label, value] of Object.entries(stats)) {
    if (consumedKeys.has(label)) {
      continue
    }
    reordered[label] = value
  }

  return reordered
}

function findStatKey(stats: Record<string, string>, aliases: string[]) {
  const normalizedAliases = new Set(aliases.map((alias) => normalizeStatKey(alias)))
  return Object.keys(stats).find((label) => normalizedAliases.has(normalizeStatKey(label))) ?? null
}

function findStatKeys(stats: Record<string, string>, aliases: string[]) {
  const normalizedAliases = new Set(aliases.map((alias) => normalizeStatKey(alias)))
  return Object.keys(stats).filter((label) => normalizedAliases.has(normalizeStatKey(label)))
}

function normalizeStatLabel(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

const groupedStatOrder = ['A', 'C', 'D', 'M', 'NPM', 'NS', 'PROC'] as const
const comparableStatLabels = ['percentage', 'points', 'time'] as const
type ComparableStatLabel = typeof comparableStatLabels[number]

function normalizeStatKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9%]+/g, '')
}

function isMemberNumberStat(label: string) {
  return normalizeStatKey(label) === 'mem'
}

function isHiddenDisplayStat(label: string) {
  const normalized = normalizeStatKey(label)
  return normalized === 'mem' || normalized === 'b' || normalized === 'apen' || normalized === 'psbl' || normalized === '%psbl'
}

function toGroupedStatLabel(label: string) {
  const normalized = normalizeStatKey(label)
  return groupedStatOrder.find((candidate) => candidate.toLowerCase() === normalized) ?? null
}

function toComparableStatLabel(label: string): ComparableStatLabel | null {
  const normalized = normalizeStatKey(label)
  if (normalized === '%' || normalized === 'psbl' || normalized === '%psbl') {
    return 'percentage'
  }
  if (normalized === 'pts' || normalized === 'stgpts' || normalized === 'stagepoints') {
    return 'points'
  }
  if (normalized === 'time') {
    return 'time'
  }
  return null
}

function formatStageSubtitle(stage: MatchStage) {
  const genericStageLabel = normalizeStageTitle(`Stage ${stage.order}`)
  const stageName = stage.name.trim()
  if (!stageName) {
    return `Stage ${stage.order}`
  }

  if (normalizeStageTitle(stageName) === genericStageLabel || normalizeStageTitle(stageName) === String(stage.order)) {
    return `Stage ${stage.order}`
  }

  return `Stage ${stage.order} - ${stage.name}`
}

function normalizeStageTitle(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function findMatchResult(match: MatchData, shooter: MatchShooter) {
  const result = match.matchResults.find((candidate) => candidate.shooterName === shooter.name)
  if (!result) {
    throw new Error('No match result found for shooter.')
  }
  return result
}

function toSelectionId(selection: OverlayViewSelection) {
  if (selection.kind.startsWith('stage-') && selection.stageId) {
    return `${selection.kind}:${selection.stageId}`
  }
  return selection.kind
}

function toSelectionFileName(selection: OverlayViewSelection) {
  if (selection.kind.startsWith('stage-') && selection.stageId) {
    return `${selection.kind}-${selection.stageId}`
  }
  return selection.kind
}
