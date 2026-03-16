import { contextBridge, ipcRenderer } from 'electron'
import type {
  MatchReference,
  OverlayExportOptions,
  OverlayExportResult,
  OverlayPreview,
  OverlayTheme,
  OverlayViewSelection,
  SessionMatch,
  ShooterResolution,
  UserProfile
} from './types'

contextBridge.exposeInMainWorld('electronAPI', {
  openPractiScoreLogin: () => ipcRenderer.invoke('auth.openPractiScoreLogin'),
  getUserProfile: (): Promise<UserProfile> => ipcRenderer.invoke('preferences.getUserProfile'),
  saveUserProfile: (profile: Partial<UserProfile>): Promise<UserProfile> => ipcRenderer.invoke('preferences.saveUserProfile', profile),
  fetchRecentMatches: (): Promise<MatchReference[]> => ipcRenderer.invoke('matches.fetchRecent'),
  importFromResultsUrl: (url: string): Promise<SessionMatch> => ipcRenderer.invoke('matches.importFromResultsUrl', url),
  scrapeDetails: (matchRef: MatchReference): Promise<SessionMatch> => ipcRenderer.invoke('matches.scrapeDetails', matchRef),
  resolveShooter: (sessionId: string, preferredName: string): Promise<ShooterResolution> => ipcRenderer.invoke('shooters.resolveForUser', sessionId, preferredName),
  pickExportFolder: (defaultPath?: string): Promise<string | null> => ipcRenderer.invoke('dialog.pickExportFolder', defaultPath),
  previewOverlay: (sessionId: string, shooterId: string, selection: OverlayViewSelection, layout: string, theme: OverlayTheme): Promise<OverlayPreview> =>
    ipcRenderer.invoke('overlay.preview', sessionId, shooterId, selection, layout, theme),
  exportOverlays: (sessionId: string, shooterId: string, options: OverlayExportOptions): Promise<OverlayExportResult> =>
    ipcRenderer.invoke('overlay.export', sessionId, shooterId, options),
  openPath: (targetPath: string): Promise<string> => ipcRenderer.invoke('shell.openPath', targetPath)
})
