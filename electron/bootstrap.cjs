const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')

process.env.APP_ROOT = path.join(__dirname, '..')
// Keep the Windows stability workaround, but only apply it before Electron
// is ready so packaged launches do not throw if the bootstrap loads late.
if (!app.isReady()) {
  app.disableHardwareAcceleration()
}

const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = RENDERER_DIST

const defaultProfile = {
  preferredShooterName: '',
  preferredTheme: 'carbon',
  preferredLayout: 'horizontal',
  preferredExportFolder: ''
}

const themes = {
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

const dimensionsByLayout = {
  horizontal: { width: 1800, height: 540 },
  vertical: { width: 1080, height: 1400 }
}

const summaryCardByLayout = {
  horizontal: {
    x: 90,
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
  vertical: {
    x: 80,
    width: 520,
    height: 140,
    radius: 34,
    labelFontSize: 24,
    valueFontSize: 56,
    labelY: 48,
    valueY: 104,
    paddingX: 34,
    secondaryX: 274
  }
}

const statGridByLayout = {
  horizontal: {
    x: 644,
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
  },
  vertical: {
    x: 80,
    columns: 2,
    columnGap: 24,
    rowGap: 24,
    cardWidth: 448,
    cardHeight: 136,
    radius: 28,
    paddingX: 28,
    labelFontSize: 24,
    valueFontSize: 38,
    labelY: 42,
    valueY: 86,
    maxCards: 8
  }
}

const framesByLayout = {
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
    bottomMargin: 52
  },
  vertical: {
    title: {
      x: 80,
      y: 48,
      width: 920,
      height: 82,
      maxFontSize: 72,
      minFontSize: 34,
      textAnchor: 'start'
    },
    summaryTitle: {
      x: 80,
      y: 48,
      width: 920,
      height: 82,
      maxFontSize: 64,
      minFontSize: 34,
      textAnchor: 'start'
    },
    subtitleY: 146,
    subtitleFontSize: 26,
    modeLabelY: 100,
    shooterY: 236,
    divisionY: 278,
    contentTopY: 294,
    bottomMargin: 72
  }
}

const groupedStatOrder = ['A', 'C', 'D', 'M', 'NPM', 'NS', 'PROC']

const sessionMatches = new Map()
let win = null

function getPreferencesPath() {
  return path.join(app.getPath('userData'), 'preferences.json')
}

async function getUserProfile() {
  const filePath = getPreferencesPath()
  if (!fs.existsSync(filePath)) {
    return defaultProfile
  }

  try {
    const raw = await fs.promises.readFile(filePath, 'utf8')
    return { ...defaultProfile, ...JSON.parse(raw) }
  } catch {
    return defaultProfile
  }
}

async function saveUserProfile(profile) {
  const nextProfile = { ...(await getUserProfile()), ...profile }
  const filePath = getPreferencesPath()
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await fs.promises.writeFile(filePath, JSON.stringify(nextProfile, null, 2), 'utf8')
  return nextProfile
}

function putSessionMatch(match) {
  const sessionId = crypto.randomUUID()
  const sessionMatch = { sessionId, match }
  sessionMatches.set(sessionId, sessionMatch)
  return sessionMatch
}

function getSessionMatch(sessionId) {
  return sessionMatches.get(sessionId) ?? null
}

function clearSessions() {
  sessionMatches.clear()
}

function loadBuiltModule(prefix) {
  const fileName = fs.readdirSync(MAIN_DIST)
    .filter((entry) => entry.startsWith(`${prefix}-`) && entry.endsWith('.js'))
    .map((entry) => ({
      entry,
      modifiedAt: fs.statSync(path.join(MAIN_DIST, entry)).mtimeMs
    }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.entry

  if (!fileName) {
    throw new Error(`Built module not found for prefix: ${prefix}`)
  }

  return import(pathToFileURL(path.join(MAIN_DIST, fileName)).href)
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function normalizeName(value) {
  return cleanShooterName(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function cleanShooterName(value) {
  return String(value || '')
    .replace(/^\s*\d+\s*[-.)]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function resolveShooter(match, preferredName) {
  const normalizedPreferred = normalizeName(preferredName)
  if (!normalizedPreferred) {
    return { shooterId: null, confidence: 'none', candidates: match.shooters }
  }

  const exact = match.shooters.find((shooter) => normalizeName(shooter.name) === normalizedPreferred)
  if (exact) {
    return { shooterId: exact.id, confidence: 'exact', candidates: [exact] }
  }

  const preferredTokens = tokenizeName(preferredName)
  const reorderedExactMatches = match.shooters.filter((shooter) => sameNameParts(shooter.name, preferredName))
  if (reorderedExactMatches.length === 1) {
    return { shooterId: reorderedExactMatches[0].id, confidence: 'exact', candidates: reorderedExactMatches }
  }
  if (reorderedExactMatches.length > 1) {
    return { shooterId: null, confidence: 'none', candidates: reorderedExactMatches }
  }

  const partials = match.shooters.filter((shooter) => matchesNameParts(shooter.name, preferredTokens) || normalizeName(shooter.name).includes(normalizedPreferred))
  if (partials.length === 1) {
    return { shooterId: partials[0].id, confidence: 'partial', candidates: partials }
  }

  return { shooterId: null, confidence: 'none', candidates: partials.length > 0 ? partials : match.shooters }
}

function tokenizeName(value) {
  return normalizeName(value)
    .split(' ')
    .filter(Boolean)
}

function sameNameParts(left, right) {
  const leftTokens = tokenizeName(left).sort()
  const rightTokens = tokenizeName(right).sort()
  return leftTokens.length > 0 && leftTokens.length === rightTokens.length && leftTokens.every((token, index) => token === rightTokens[index])
}

function matchesNameParts(candidateName, preferredTokens) {
  if (preferredTokens.length === 0) return false
  const candidateTokens = tokenizeName(candidateName)
  return preferredTokens.every((preferredToken) => candidateTokens.some((candidateToken) => candidateToken.includes(preferredToken)))
}

async function createPreview(sessionId, shooterId, selection, layout, theme) {
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
    imageDataUrl: await renderPngDataUrl(content, layout, theme)
  }
}

async function exportOverlays(sessionId, shooterId, options) {
  const sessionMatch = getSessionMatch(sessionId)
  if (!sessionMatch) {
    throw new Error('Session match not found.')
  }

  const shooter = sessionMatch.match.shooters.find((candidate) => candidate.id === shooterId)
  if (!shooter) {
    throw new Error('Shooter not found.')
  }

  const baseDir = (options.outputDir || '').trim()
  if (!baseDir) {
    throw new Error('Export folder not selected.')
  }
  await fs.promises.mkdir(baseDir, { recursive: true })

  const files = []
  const selections = options.mode === 'single'
    ? (options.selection ? [options.selection] : [])
    : [
        { kind: 'match-summary' },
        ...sessionMatch.match.stages.map((stage) => ({
          kind: 'stage-summary',
          stageId: stage.id
        }))
      ]

  if (selections.length === 0) {
    throw new Error('No overlay selected for export.')
  }

  for (const selection of selections) {
    const buffer = await renderPngBuffer(buildOverlayContent(sessionMatch.match, shooter, selection), options.layout, options.theme)
    const filePath = path.join(baseDir, `${toSelectionFileName(sessionMatch.match, selection)}.png`)
    await fs.promises.writeFile(filePath, buffer)
    files.push(filePath)
  }

  return { outputDir: baseDir, files }
}

async function renderPngDataUrl(content, layout, themeName) {
  const buffer = await renderPngBuffer(content, layout, themeName)
  return `data:image/png;base64,${buffer.toString('base64')}`
}

async function renderPngBuffer(content, layout, themeName) {
  const svg = buildSvg(content, layout, themes[themeName])
  const { width, height } = dimensionsByLayout[layout]
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden;">${svg}</body></html>`
  const previewWindow = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000'
  })
  try {
    await previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await previewWindow.webContents.executeJavaScript(
      "document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : Promise.resolve(true)",
      true
    )
    const image = await previewWindow.webContents.capturePage()
    const png = image.toPNG()
    if (png.length) {
      return png
    }
  } finally {
    previewWindow.destroy()
  }

  throw new Error('Failed to render overlay image.')
}

function buildSvg(content, layout, theme) {
  const { width, height } = dimensionsByLayout[layout]
  const frame = framesByLayout[layout]
  const titleFrame = frame.summaryTitle
  const stats = buildDisplayStats(content.stats, statGridByLayout[layout].maxCards)
  const contentFrames = resolveContentFrames(frame, width, height, summaryCardByLayout[layout], statGridByLayout[layout], stats)
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
  const statBlocks = buildStatBlocks(stats, contentFrames.statGrid, theme)
  const summaryBlock = buildSummaryBlock(content, contentFrames.summaryCard, theme)
  const subtitleBlock = buildSubtitleText(content.subtitle, frame, theme)

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

function resolveContentFrames(frame, canvasWidth, canvasHeight, summaryCard, statGrid, stats) {
  const safeLeft = frame.title.x
  const safeRight = canvasWidth - frame.title.x
  const safeBottom = canvasHeight - frame.bottomMargin
  const interZoneGap = Math.max(18, statGrid.rowGap)
  const summaryY = safeBottom - summaryCard.height
  const originGridLayout = positionStatBlocks(stats, { ...statGrid, y: 0 })
  const gridHeight = originGridLayout.maxBottom
  const summaryRight = summaryCard.x + summaryCard.width
  const initialGridY = frame.contentTopY

  let gridX = statGrid.x
  const rightOverflow = originGridLayout.maxRight - safeRight
  if (rightOverflow > 0) {
    gridX -= rightOverflow
  }
  const shiftedLeft = originGridLayout.minLeft + (gridX - statGrid.x)
  if (shiftedLeft < safeLeft) {
    gridX += safeLeft - shiftedLeft
  }

  const shiftedRight = gridX + originGridLayout.maxRight - originGridLayout.minLeft
  const overlapsSummaryHorizontally = !(gridX >= summaryRight + interZoneGap || shiftedRight <= summaryCard.x - interZoneGap)
  const maxGridBottom = overlapsSummaryHorizontally ? summaryY - interZoneGap : safeBottom
  const clearsTextColumn = gridX >= summaryRight + interZoneGap
  const headerBandBottom = frame.subtitleY + frame.subtitleFontSize + Math.max(18, Math.floor(interZoneGap * 0.8))
  const textBandBottom = frame.divisionY + Math.max(22, Math.floor(interZoneGap * 0.9))
  const preferredGridY = clearsTextColumn ? headerBandBottom : textBandBottom
  const resolvedGridY = Math.max(frame.subtitleY + 8, Math.min(preferredGridY, maxGridBottom - gridHeight))
  const groupedBlock = originGridLayout.blocks.find((block) => block.item.kind === 'grouped')
  const alignedSummaryCard = clearsTextColumn
    ? {
        ...summaryCard,
        y: groupedBlock
          ? resolvedGridY + groupedBlock.y + Math.max(0, Math.round((groupedBlock.height - summaryCard.height) / 2))
          : summaryY
      }
    : { ...summaryCard, y: summaryY }

  return {
    summaryCard: alignedSummaryCard,
    statGrid: {
      ...statGrid,
      x: gridX,
      y: resolvedGridY
    }
  }
}

function buildSummaryBlock(content, frame, theme) {
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

function buildSubtitleText(subtitle, frame, theme) {
  return `<text x="${frame.title.x}" y="${frame.subtitleY}" font-size="${frame.subtitleFontSize}" font-family="Segoe UI, sans-serif" fill="${theme.muted}">${escapeXml(subtitle)}</text>`
}

function buildStatBlocks(stats, frame, theme) {
  return positionStatBlocks(stats, frame).blocks
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

function buildGroupedStatBlock(item, x, y, width, height, frame, theme) {
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

function buildGroupedStatRow(entries, x, rowWidth, labelsY, valuesY, labelFontSize, valueFontSize, theme) {
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

function positionStatBlocks(stats, frame) {
  const occupied = new Set()
  const rawBlocks = []

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

function stretchDefaultRows(blocks, frame) {
  const totalGridWidth = frame.cardWidth * frame.columns + frame.columnGap * (frame.columns - 1)
  const rows = new Map()

  blocks.forEach((block) => {
    if (!rows.has(block.row)) {
      rows.set(block.row, [])
    }
    rows.get(block.row).push(block)
  })

  return blocks.map((block) => {
    const rowBlocks = rows.get(block.row) || []
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

function getStatSpan(item, frame) {
  if (item.kind !== 'grouped') {
    return { colSpan: 1, rowSpan: 1 }
  }

  return {
    colSpan: frame.columns,
    rowSpan: 1
  }
}

function findStatPlacement(occupied, columns, colSpan, rowSpan) {
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

function canPlaceStat(occupied, row, column, colSpan, rowSpan) {
  for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < colSpan; columnOffset += 1) {
      if (occupied.has(`${row + rowOffset}:${column + columnOffset}`)) {
        return false
      }
    }
  }

  return true
}

function markStatPlacement(occupied, row, column, colSpan, rowSpan) {
  for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < colSpan; columnOffset += 1) {
      occupied.add(`${row + rowOffset}:${column + columnOffset}`)
    }
  }
}

function buildDisplayStats(stats, maxCards) {
  const orderedEntries = Object.entries(stats)
  const filteredEntries = orderedEntries.filter(([label]) => !isHiddenDisplayStat(label))

  const groupedEntriesByKey = new Map()
  for (const groupedLabel of groupedStatOrder) {
    groupedEntriesByKey.set(groupedLabel, { label: groupedLabel, value: 'N/A' })
  }

  let firstGroupedIndex = -1
  const remainingEntries = []
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

    remainingEntries.push({
      kind: 'default',
      label,
      value
    })
  })

  if (firstGroupedIndex === -1) {
    return remainingEntries.slice(0, maxCards)
  }

  const groupedBlock = {
    kind: 'grouped',
    label: 'Hits / Penalties',
    entries: groupedStatOrder.map((label) => groupedEntriesByKey.get(label) || { label, value: 'N/A' })
  }

  const insertAt = Math.min(firstGroupedIndex, remainingEntries.length)
  return [
    ...remainingEntries.slice(0, insertAt),
    groupedBlock,
    ...remainingEntries.slice(insertAt)
  ].slice(0, maxCards)
}

function buildTitleText(title, frame, theme) {
  const { fontSize, textLength, textX } = fitTitleText(title, frame)
  const centerY = frame.y + frame.height / 2
  const textLengthAttribute = textLength ? ` textLength="${textLength}" lengthAdjust="spacingAndGlyphs"` : ''
  const anchorAttribute = frame.textAnchor === 'middle' ? ' text-anchor="middle"' : ''

  return `<text x="${textX}" y="${centerY}" font-size="${fontSize}" font-weight="800" font-family="Segoe UI, sans-serif" dominant-baseline="middle"${anchorAttribute} fill="${theme.text}"${textLengthAttribute}>${escapeXml(title)}</text>`
}

function buildFittedText(text, options) {
  const { fontSize, textLength } = fitInlineText(text, options.maxWidth, options.maxFontSize, options.minFontSize)
  const anchor = options.anchor === 'middle' ? ' text-anchor="middle"' : ''
  const weight = options.fontWeight ? ` font-weight="${options.fontWeight}"` : ''
  const textLengthAttribute = textLength ? ` textLength="${textLength}" lengthAdjust="spacingAndGlyphs"` : ''
  return `<text x="${options.x}" y="${options.y}" font-size="${fontSize}"${weight} font-family="Segoe UI, sans-serif"${anchor} fill="${options.fill}"${textLengthAttribute}>${escapeXml(text)}</text>`
}

function fitInlineText(text, maxWidth, maxFontSize, minFontSize) {
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

function fitTitleText(title, frame) {
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

function estimateTitleWidth(title, fontSize) {
  let width = 0
  for (const character of title) {
    width += measureCharacterWidth(character)
  }
  return width * fontSize
}

function measureCharacterWidth(character) {
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

function buildOverlayContent(match, shooter, selection) {
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

function buildComparisonStats(overallStats, divisionStats) {
  const divisionFirstStats = { ...(divisionStats || overallStats) }
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

function buildMatchSummaryStats(overallStats, divisionStats) {
  return reorderStats(buildComparisonStats(overallStats, divisionStats), [
    ['%', 'psbl', '%psbl', 'percent'],
    ['time'],
    ['pts', 'matchpoints', 'points']
  ])
}

function buildStageSummaryStats(overallStats, divisionStats) {
  const orderedStageStats = {
    '%': buildStageComparisonValue(overallStats, divisionStats, ['%'], true),
    HF: buildStageComparisonValue(overallStats, divisionStats, ['hf', 'hitfactor'], false),
    Time: buildStageComparisonValue(overallStats, divisionStats, ['time'], true),
    'Pts / Stg Pts': `${buildStageComparisonValue(overallStats, divisionStats, ['pts'], true)} / ${buildStageComparisonValue(overallStats, divisionStats, ['stgpts', 'stagepoints'], false)}`
  }

  const consumedKeys = new Set([
    ...findStatKeys(overallStats, ['%', 'pts', 'stgpts', 'stagepoints', 'hf', 'hitfactor', 'time']),
    ...findStatKeys(divisionStats || {}, ['%', 'pts', 'stgpts', 'stagepoints', 'hf', 'hitfactor', 'time'])
  ].map((key) => normalizeStatKey(key)))

  const stageFirstStats = divisionStats || overallStats
  for (const [label, value] of Object.entries(stageFirstStats)) {
    const normalized = normalizeStatKey(label)
    if (consumedKeys.has(normalized) || isHiddenDisplayStat(label)) {
      continue
    }
    orderedStageStats[label] = value
  }

  return orderedStageStats
}

function buildStageComparisonValue(overallStats, divisionStats, aliases, includeComparison) {
  const overallKey = findStatKey(overallStats, aliases)
  const divisionKey = findStatKey(divisionStats || {}, aliases)
  const primaryValue = divisionKey
    ? divisionStats[divisionKey]
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

function findComparableStatKey(stats, targetLabel) {
  const matchingKeys = Object.keys(stats).filter((label) => toComparableStatLabel(label) === targetLabel)
  if (matchingKeys.length === 0) {
    return null
  }

  if (targetLabel === 'percentage') {
    return matchingKeys.find((label) => normalizeStatKey(label) === '%')
      || matchingKeys.find((label) => normalizeStatKey(label) === 'psbl')
      || matchingKeys.find((label) => normalizeStatKey(label) === '%psbl')
      || matchingKeys[0]
  }

  return matchingKeys[0]
}

function reorderStats(stats, preferredAliasGroups) {
  const reordered = {}
  const consumedKeys = new Set()

  for (const aliases of preferredAliasGroups) {
    const key = findStatKey(stats, aliases)
    if (!key || consumedKeys.has(key)) {
      continue
    }
    reordered[key] = stats[key]
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

function findStatKey(stats, aliases) {
  const normalizedAliases = new Set(aliases.map((alias) => normalizeStatKey(alias)))
  return Object.keys(stats).find((label) => normalizedAliases.has(normalizeStatKey(label))) || null
}

function findStatKeys(stats, aliases) {
  const normalizedAliases = new Set(aliases.map((alias) => normalizeStatKey(alias)))
  return Object.keys(stats).filter((label) => normalizedAliases.has(normalizeStatKey(label)))
}

function normalizeStatLabel(value) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

const comparableStatLabels = ['percentage', 'points', 'time']

function normalizeStatKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9%]+/g, '')
}

function isMemberNumberStat(label) {
  return normalizeStatKey(label) === 'mem'
}

function isHiddenDisplayStat(label) {
  const normalized = normalizeStatKey(label)
  return normalized === 'mem' || normalized === 'b' || normalized === 'apen' || normalized === 'psbl' || normalized === '%psbl'
}

function toGroupedStatLabel(label) {
  const normalized = normalizeStatKey(label)
  return groupedStatOrder.find((candidate) => candidate.toLowerCase() === normalized) || null
}

function toComparableStatLabel(label) {
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

function formatStageSubtitle(stage) {
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

function normalizeStageTitle(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function findMatchResult(match, shooter) {
  const result = match.matchResults.find((candidate) => candidate.shooterName === shooter.name)
  if (!result) {
    throw new Error('No match result found for shooter.')
  }
  return result
}

function toSelectionId(selection) {
  if (selection.kind.startsWith('stage-') && selection.stageId) {
    return `${selection.kind}:${selection.stageId}`
  }
  return selection.kind
}

function toSelectionFileName(match, selection) {
  if (selection.kind.startsWith('stage-') && selection.stageId) {
    const stage = match.stages.find((candidate) => candidate.id === selection.stageId)
    if (stage) {
      return `Stage ${stage.order}`
    }
  }
  return selection.kind
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1200,
    minHeight: 800,
    backgroundColor: '#08111b',
    title: 'Stage Overlay',
    webPreferences: {
      preload: path.join(MAIN_DIST, 'preload.mjs'),
      contextIsolation: true
    }
  })

  await win.loadFile(path.join(RENDERER_DIST, 'index.html'))
}

function registerHandlers() {
  ipcMain.handle('auth.openPractiScoreLogin', async () => {
    const { openAuthenticationWindow } = await loadBuiltModule('scraper')
    return openAuthenticationWindow()
  })

  ipcMain.handle('preferences.getUserProfile', () => getUserProfile())
  ipcMain.handle('preferences.saveUserProfile', (_, profile) => saveUserProfile(profile))
  ipcMain.handle('dialog.pickExportFolder', async (_, defaultPath) => {
    const result = await dialog.showOpenDialog(win ?? undefined, {
      title: 'Choose export folder',
      defaultPath: defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('matches.fetchRecent', async () => {
    const { fetchRecentMatches } = await loadBuiltModule('scraper')
    return fetchRecentMatches()
  })

  ipcMain.handle('matches.importFromResultsUrl', async (_, url) => {
    const { scrapeMatchDetails } = await loadBuiltModule('scraper')
    const match = await scrapeMatchDetails({ url })
    return putSessionMatch(match)
  })

  ipcMain.handle('matches.scrapeDetails', async (_, matchRef) => {
    const { scrapeMatchDetails } = await loadBuiltModule('scraper')
    const match = await scrapeMatchDetails(matchRef)
    return putSessionMatch(match)
  })

  ipcMain.handle('shooters.resolveForUser', async (_, sessionId, preferredName) => {
    const sessionMatch = getSessionMatch(sessionId)
    if (!sessionMatch) {
      throw new Error('Session match not found.')
    }

    return resolveShooter(sessionMatch.match, preferredName)
  })

  ipcMain.handle('overlay.preview', async (_, sessionId, shooterId, selection, layout, theme) =>
    createPreview(sessionId, shooterId, selection, layout, theme)
  )

  ipcMain.handle('overlay.export', async (_, sessionId, shooterId, options) => exportOverlays(sessionId, shooterId, options))

  ipcMain.handle('shell.openPath', (_, targetPath) => shell.openPath(targetPath))
}

app.whenReady().then(async () => {
  registerHandlers()
  await createWindow()
})

app.on('window-all-closed', () => {
  clearSessions()
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow()
  }
})
