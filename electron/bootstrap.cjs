const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')

process.env.APP_ROOT = path.join(__dirname, '..')
app.disableHardwareAcceleration()

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

const framesByLayout = {
  horizontal: {
    title: {
      x: 90,
      y: 130,
      width: 700,
      height: 102,
      maxFontSize: 86,
      minFontSize: 38,
      textAnchor: 'middle'
    },
    modeLabelY: 120,
    shooterY: 280,
    divisionY: 322,
    summaryTranslateX: 90,
    summaryTranslateY: 350
  },
  vertical: {
    title: {
      x: 80,
      y: 116,
      width: 920,
      height: 100,
      maxFontSize: 72,
      minFontSize: 34,
      textAnchor: 'middle'
    },
    modeLabelY: 100,
    shooterY: 236,
    divisionY: 282,
    summaryTranslateX: 80,
    summaryTranslateY: 320
  }
}

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
        { kind: 'match-overall' },
        { kind: 'division-overall' },
        ...sessionMatch.match.stages.flatMap((stage) => [
          { kind: 'stage-overall', stageId: stage.id },
          { kind: 'stage-division', stageId: stage.id }
        ])
      ]

  if (selections.length === 0) {
    throw new Error('No overlay selected for export.')
  }

  for (const selection of selections) {
    const buffer = await renderPngBuffer(buildOverlayContent(sessionMatch.match, shooter, selection), options.layout, options.theme)
    const filePath = path.join(baseDir, `${toSelectionFileName(selection)}.png`)
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
  const stats = Object.entries(content.stats).slice(0, layout === 'horizontal' ? 6 : 8)

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
      <text x="${frame.title.x}" y="${frame.modeLabelY}" font-size="34" font-family="Segoe UI, sans-serif" fill="${theme.muted}">${escapeXml(content.modeLabel)}</text>
      ${buildTitleText(content.title, frame.title, theme)}
      <text x="${frame.title.x}" y="${frame.shooterY}" font-size="34" font-family="Segoe UI, sans-serif" fill="${theme.accent}">${escapeXml(content.shooterName)}</text>
      <text x="${frame.title.x}" y="${frame.divisionY}" font-size="24" font-family="Segoe UI, sans-serif" fill="${theme.muted}">Division: ${escapeXml(content.divisionLabel)}</text>
      <g transform="translate(${frame.summaryTranslateX}, ${frame.summaryTranslateY})">
        <rect width="520" height="116" rx="30" fill="${theme.panel}" />
        <text x="28" y="40" font-size="24" font-family="Segoe UI, sans-serif" fill="${theme.muted}">${escapeXml(content.primaryLabel)}</text>
        <text x="28" y="88" font-size="54" font-weight="800" font-family="Segoe UI, sans-serif" fill="${theme.text}">${escapeXml(content.primaryValue)}</text>
        <text x="280" y="40" font-size="24" font-family="Segoe UI, sans-serif" fill="${theme.muted}">${escapeXml(content.secondaryLabel)}</text>
        <text x="280" y="88" font-size="54" font-weight="800" font-family="Segoe UI, sans-serif" fill="${theme.text}">${escapeXml(content.secondaryValue)}</text>
      </g>
    `
    : `
      <text x="${frame.title.x}" y="${frame.modeLabelY}" font-size="28" font-family="Segoe UI, sans-serif" fill="${theme.muted}">${escapeXml(content.modeLabel)}</text>
      ${buildTitleText(content.title, frame.title, theme)}
      <text x="${frame.title.x}" y="${frame.shooterY}" font-size="30" font-family="Segoe UI, sans-serif" fill="${theme.accent}">${escapeXml(content.shooterName)}</text>
      <text x="${frame.title.x}" y="${frame.divisionY}" font-size="24" font-family="Segoe UI, sans-serif" fill="${theme.muted}">Division: ${escapeXml(content.divisionLabel)}</text>
      <g transform="translate(${frame.summaryTranslateX}, ${frame.summaryTranslateY})">
        <rect width="920" height="140" rx="34" fill="${theme.panel}" />
        <text x="34" y="50" font-size="24" font-family="Segoe UI, sans-serif" fill="${theme.muted}">${escapeXml(content.primaryLabel)}</text>
        <text x="34" y="105" font-size="64" font-weight="800" font-family="Segoe UI, sans-serif" fill="${theme.text}">${escapeXml(content.primaryValue)}</text>
        <text x="460" y="50" font-size="24" font-family="Segoe UI, sans-serif" fill="${theme.muted}">${escapeXml(content.secondaryLabel)}</text>
        <text x="460" y="105" font-size="64" font-weight="800" font-family="Segoe UI, sans-serif" fill="${theme.text}">${escapeXml(content.secondaryValue)}</text>
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

function buildTitleText(title, frame, theme) {
  const { fontSize, textLength, textX } = fitTitleText(title, frame)
  const centerY = frame.y + frame.height / 2
  const textLengthAttribute = textLength ? ` textLength="${textLength}" lengthAdjust="spacingAndGlyphs"` : ''
  const anchorAttribute = frame.textAnchor === 'middle' ? ' text-anchor="middle"' : ''

  return `<text x="${textX}" y="${centerY}" font-size="${fontSize}" font-weight="800" font-family="Segoe UI, sans-serif" dominant-baseline="middle"${anchorAttribute} fill="${theme.text}"${textLengthAttribute}>${escapeXml(title)}</text>`
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

  if (selection.kind === 'match-overall') {
    return {
      modeLabel: 'Match Overall',
      title: match.name,
      shooterName: shooter.name,
      divisionLabel: shooter.division || 'Unknown Division',
      primaryLabel: 'Overall',
      primaryValue: summary.overallPlacement || 'N/A',
      secondaryLabel: 'Division',
      secondaryValue: summary.divisionPlacement || 'N/A',
      stats: summary.stats
    }
  }

  if (selection.kind === 'division-overall') {
    return {
      modeLabel: 'Division Overall',
      title: match.name,
      shooterName: shooter.name,
      divisionLabel: shooter.division || 'Unknown Division',
      primaryLabel: 'Division',
      primaryValue: summary.divisionPlacement || 'N/A',
      secondaryLabel: 'Overall',
      secondaryValue: summary.overallPlacement || 'N/A',
      stats: summary.divisionStats ?? summary.stats
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

  if (selection.kind === 'stage-division') {
    return {
      modeLabel: 'Stage Division',
      title: stage.name,
      shooterName: shooter.name,
      divisionLabel: shooter.division || result.division || 'Unknown Division',
      primaryLabel: 'Division',
      primaryValue: result.divisionPlacement || 'N/A',
      secondaryLabel: 'Overall',
      secondaryValue: result.overallPlacement || 'N/A',
      stats: result.divisionStats ?? result.stats
    }
  }

  return {
    modeLabel: 'Stage Overall',
    title: stage.name,
    shooterName: shooter.name,
    divisionLabel: shooter.division || result.division || 'Unknown Division',
    primaryLabel: 'Overall',
    primaryValue: result.overallPlacement || 'N/A',
    secondaryLabel: 'Division',
    secondaryValue: result.divisionPlacement || 'N/A',
    stats: result.stats
  }
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

function toSelectionFileName(selection) {
  if (selection.kind.startsWith('stage-') && selection.stageId) {
    return `${selection.kind}-${selection.stageId}`
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
