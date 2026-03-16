import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPreview, exportOverlays } from './overlayRenderer'
import { resolveShooter } from './parsers'
import { getUserProfile, saveUserProfile } from './preferences'
import { fetchRecentMatches, openAuthenticationWindow, scrapeMatchDetails } from './scraper'
import { clearSessions, getSessionMatch, putSessionMatch } from './sessionStore'
import type { MatchReference } from './types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null = null

async function createWindow() {
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

  if (VITE_DEV_SERVER_URL) {
    await win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    await win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.whenReady().then(async () => {
  await createWindow()

  ipcMain.handle('auth.openPractiScoreLogin', () => openAuthenticationWindow())
  ipcMain.handle('preferences.getUserProfile', () => getUserProfile())
  ipcMain.handle('preferences.saveUserProfile', (_, profile) => saveUserProfile(profile))
  ipcMain.handle('matches.fetchRecent', () => fetchRecentMatches())
  ipcMain.handle('matches.importFromResultsUrl', async (_, url: string) => {
    const match = await scrapeMatchDetails({ url })
    return putSessionMatch(match)
  })
  ipcMain.handle('matches.scrapeDetails', async (_, matchRef: MatchReference) => {
    const match = await scrapeMatchDetails(matchRef)
    return putSessionMatch(match)
  })
  ipcMain.handle('shooters.resolveForUser', (_, sessionId: string, preferredName: string) => {
    const sessionMatch = getSessionMatch(sessionId)
    if (!sessionMatch) {
      throw new Error('Session match not found.')
    }
    return resolveShooter(sessionMatch.match, preferredName)
  })
  ipcMain.handle('overlay.preview', (_, sessionId: string, shooterId: string, stageId: string, layout, theme) =>
    createPreview(sessionId, shooterId, stageId, layout, theme)
  )
  ipcMain.handle('overlay.export', (_, sessionId: string, shooterId: string, options) =>
    exportOverlays(sessionId, shooterId, options)
  )
  ipcMain.handle('shell.openPath', (_, targetPath: string) => shell.openPath(targetPath))
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
