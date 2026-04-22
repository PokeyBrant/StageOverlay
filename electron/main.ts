import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getUserProfile, saveUserProfile } from './preferences'
import { clearSessions, getSessionMatch, putSessionMatch } from './sessionStore'
import { getCurrentSourceStatus, SOURCE_STATUS_CHANNEL } from './sourceStatus'
import type { OpenDialogOptions } from 'electron'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

// Some Windows environments crash in Chromium startup paths before the
// first window appears, so we keep this workaround, but only while Electron
// is still unready. Packaged builds can load late enough that an unconditional
// call would throw.
if (!app.isReady()) {
  app.disableHardwareAcceleration()
}

app.setName('Stage Overlay')
app.setAppUserModelId('com.incy.stageoverlay')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null = null
const hasSingleInstanceLock = app.requestSingleInstanceLock()

function writeStartupLog(message: string) {
  try {
    const logPath = path.join(process.env.APP_ROOT ?? __dirname, 'electron-startup.log')
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`, 'utf8')
  } catch {
    // Ignore logging failures so diagnostics do not affect app startup.
  }
}

function loadMatchDataProviderModule() {
  return import('./matchDataProvider')
}

function loadParsersModule() {
  return import('./parsers')
}

function loadOverlayRendererModule() {
  return import('./overlayRenderer')
}

async function createWindow() {
  if (win && !win.isDestroyed()) {
    return win
  }

  writeStartupLog('createWindow:start')
  const nextWindow = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 820,
    minHeight: 800,
    backgroundColor: '#08111b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs')
    }
  })

  win = nextWindow

  nextWindow.webContents.on('did-finish-load', () => {
    writeStartupLog('webContents:did-finish-load')
    const currentSourceStatus = getCurrentSourceStatus()
    if (currentSourceStatus) {
      win?.webContents.send(SOURCE_STATUS_CHANNEL, currentSourceStatus)
    }
  })
  nextWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription) =>
    writeStartupLog(`webContents:did-fail-load:${errorCode}:${errorDescription}`)
  )
  nextWindow.webContents.on('render-process-gone', (_, details) =>
    writeStartupLog(`webContents:render-process-gone:${details.reason}`)
  )
  nextWindow.on('closed', () => {
    writeStartupLog('window:closed')
    if (win === nextWindow) {
      win = null
    }
  })

  if (VITE_DEV_SERVER_URL) {
    writeStartupLog(`createWindow:loadURL:${VITE_DEV_SERVER_URL}`)
    await nextWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    writeStartupLog(`createWindow:loadFile:${path.join(RENDERER_DIST, 'index.html')}`)
    await nextWindow.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  writeStartupLog('createWindow:done')
  return nextWindow
}

function focusMainWindow() {
  if (!win || win.isDestroyed()) {
    return
  }

  if (win.isMinimized()) {
    win.restore()
  }

  win.show()
  win.focus()
}

if (!hasSingleInstanceLock) {
  app.quit()
}

app.on('second-instance', () => {
  writeStartupLog('app:second-instance')
  focusMainWindow()
})

app.whenReady().then(async () => {
  writeStartupLog('app:whenReady')
  if (!hasSingleInstanceLock) {
    return
  }
  await createWindow()
  writeStartupLog('app:register-handlers')

  ipcMain.handle('source.getProviderStatus', async () => {
    const { getMatchDataProviderStatus } = await loadMatchDataProviderModule()
    return getMatchDataProviderStatus()
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
  ipcMain.handle('dialog.pickBackgroundImage', async (_, defaultPath?: string) => {
    const dialogOptions: OpenDialogOptions = {
      title: 'Choose overlay background image',
      defaultPath: defaultPath || undefined,
      properties: ['openFile'],
      filters: [
        { name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }
    const result = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle('matches.importFile', async (_, sourceUrl?: string) => {
    const dialogOptions: OpenDialogOptions = {
      title: 'Choose match data file',
      properties: ['openFile'],
      filters: [
        { name: 'HTML Files', extensions: ['html', 'htm'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }
    const result = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    const selectedFile = result.canceled ? null : (result.filePaths[0] ?? null)
    if (!selectedFile) {
      return null
    }

    const { importMatchFile } = await loadMatchDataProviderModule()
    const match = await importMatchFile(selectedFile, sourceUrl)
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
  ipcMain.handle('overlay.preview', async (_, sessionId: string, shooterId: string, selection, settings) => {
    const { createPreview } = await loadOverlayRendererModule()
    return createPreview(sessionId, shooterId, selection, settings)
  })
  ipcMain.handle('overlay.export', async (_, sessionId: string, shooterId: string, options) => {
    const { exportOverlays } = await loadOverlayRendererModule()
    return exportOverlays(sessionId, shooterId, options)
  })
  ipcMain.handle('shell.openExternalUrl', async (_, targetUrl: string) => shell.openExternal(targetUrl))
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

app.on('before-quit', () => {
  void loadMatchDataProviderModule()
    .then(({ disposeMatchDataProvider }) => disposeMatchDataProvider?.())
    .catch(() => {
      // Best-effort cleanup only.
    })
})

app.on('activate', () => {
  writeStartupLog('app:activate')
  if (!win || win.isDestroyed() || BrowserWindow.getAllWindows().length === 0) {
    void createWindow()
    return
  }

  focusMainWindow()
})
