import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getUserProfile, saveUserProfile } from './preferences'
import { clearSessions, getSessionMatch, putSessionMatch } from './sessionStore'
import type { MatchReference } from './types'
import type { OpenDialogOptions } from 'electron'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

// Some Windows environments crash in Chromium startup paths before the
// first window appears, so we start without GPU acceleration.
app.disableHardwareAcceleration()

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null = null

function writeStartupLog(message: string) {
  try {
    const logPath = path.join(process.env.APP_ROOT ?? __dirname, 'electron-startup.log')
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`, 'utf8')
  } catch {
    // Ignore logging failures so diagnostics do not affect app startup.
  }
}

function loadScraperModule() {
  return import('./scraper')
}

function loadParsersModule() {
  return import('./parsers')
}

function loadOverlayRendererModule() {
  return import('./overlayRenderer')
}

async function createWindow() {
  writeStartupLog('createWindow:start')
  win = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1200,
    minHeight: 800,
    backgroundColor: '#08111b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs')
    }
  })

  win.webContents.on('did-finish-load', () => writeStartupLog('webContents:did-finish-load'))
  win.webContents.on('did-fail-load', (_, errorCode, errorDescription) =>
    writeStartupLog(`webContents:did-fail-load:${errorCode}:${errorDescription}`)
  )
  win.webContents.on('render-process-gone', (_, details) =>
    writeStartupLog(`webContents:render-process-gone:${details.reason}`)
  )
  win.on('closed', () => writeStartupLog('window:closed'))

  if (VITE_DEV_SERVER_URL) {
    writeStartupLog(`createWindow:loadURL:${VITE_DEV_SERVER_URL}`)
    await win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    writeStartupLog(`createWindow:loadFile:${path.join(RENDERER_DIST, 'index.html')}`)
    await win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  writeStartupLog('createWindow:done')
}

app.whenReady().then(async () => {
  writeStartupLog('app:whenReady')
  await createWindow()
  writeStartupLog('app:register-handlers')

  ipcMain.handle('auth.openPractiScoreLogin', async () => {
    const { openAuthenticationWindow } = await loadScraperModule()
    return openAuthenticationWindow()
  })
  ipcMain.handle('preferences.getUserProfile', () => getUserProfile())
  ipcMain.handle('preferences.saveUserProfile', (_, profile) => saveUserProfile(profile))
  ipcMain.handle('dialog.pickExportFolder', async (_, defaultPath?: string) => {
    const dialogOptions: OpenDialogOptions = {
      title: 'Choose export folder',
      defaultPath: defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle('matches.fetchRecent', async () => {
    const { fetchRecentMatches } = await loadScraperModule()
    return fetchRecentMatches()
  })
  ipcMain.handle('matches.importFromResultsUrl', async (_, url: string) => {
    const { scrapeMatchDetails } = await loadScraperModule()
    const match = await scrapeMatchDetails({ url })
    return putSessionMatch(match)
  })
  ipcMain.handle('matches.scrapeDetails', async (_, matchRef: MatchReference) => {
    const { scrapeMatchDetails } = await loadScraperModule()
    const match = await scrapeMatchDetails(matchRef)
    return putSessionMatch(match)
  })
  ipcMain.handle('shooters.resolveForUser', async (_, sessionId: string, preferredName: string) => {
    const sessionMatch = getSessionMatch(sessionId)
    if (!sessionMatch) {
      throw new Error('Session match not found.')
    }
    const { resolveShooter } = await loadParsersModule()
    return resolveShooter(sessionMatch.match, preferredName)
  })
  ipcMain.handle('overlay.preview', async (_, sessionId: string, shooterId: string, selection, layout, theme) => {
    const { createPreview } = await loadOverlayRendererModule()
    return createPreview(sessionId, shooterId, selection, layout, theme)
  })
  ipcMain.handle('overlay.export', async (_, sessionId: string, shooterId: string, options) => {
    const { exportOverlays } = await loadOverlayRendererModule()
    return exportOverlays(sessionId, shooterId, options)
  })
  ipcMain.handle('shell.openPath', (_, targetPath: string) => shell.openPath(targetPath))
  writeStartupLog('app:handlers-ready')
})

app.on('window-all-closed', () => {
  writeStartupLog('app:window-all-closed')
  clearSessions()
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  writeStartupLog('app:activate')
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow()
  }
})
