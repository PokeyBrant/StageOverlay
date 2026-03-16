import { contextBridge, ipcRenderer } from 'electron'
import type { MatchReference, OverlayExportOptions, OverlayExportResult, OverlayPreview, OverlayTheme, SessionMatch, ShooterResolution, UserProfile } from './types'

contextBridge.exposeInMainWorld('electronAPI', {
  openPractiScoreLogin: () => ipcRenderer.invoke('auth.openPractiScoreLogin'),
  getUserProfile: (): Promise<UserProfile> => ipcRenderer.invoke('preferences.getUserProfile'),
  saveUserProfile: (profile: Partial<UserProfile>): Promise<UserProfile> => ipcRenderer.invoke('preferences.saveUserProfile', profile),
  fetchRecentMatches: (): Promise<MatchReference[]> => ipcRenderer.invoke('matches.fetchRecent'),
  importFromResultsUrl: (url: string): Promise<SessionMatch> => ipcRenderer.invoke('matches.importFromResultsUrl', url),
  scrapeDetails: (matchRef: MatchReference): Promise<SessionMatch> => ipcRenderer.invoke('matches.scrapeDetails', matchRef),
  resolveShooter: (sessionId: string, preferredName: string): Promise<ShooterResolution> => ipcRenderer.invoke('shooters.resolveForUser', sessionId, preferredName),
  previewOverlay: (sessionId: string, shooterId: string, stageId: string, layout: string, theme: OverlayTheme): Promise<OverlayPreview> =>
    ipcRenderer.invoke('overlay.preview', sessionId, shooterId, stageId, layout, theme),
  exportOverlays: (sessionId: string, shooterId: string, options: OverlayExportOptions): Promise<OverlayExportResult> =>
    ipcRenderer.invoke('overlay.export', sessionId, shooterId, options),
  openPath: (targetPath: string): Promise<string> => ipcRenderer.invoke('shell.openPath', targetPath)
})
