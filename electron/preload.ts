import { contextBridge, ipcRenderer } from 'electron'
import type {
  OverlayExportOptions,
  OverlayRenderSettings,
  OverlayExportResult,
  OverlayPreview,
  OverlayViewSelection,
  MatchDataProviderStatus,
  SessionMatch,
  ShooterResolution,
  SourceStatusEvent,
  UserProfile
} from './types'
import { SOURCE_STATUS_CHANNEL } from './sourceStatus'

contextBridge.exposeInMainWorld('electronAPI', {
  getMatchDataProviderStatus: (): Promise<MatchDataProviderStatus> => ipcRenderer.invoke('source.getProviderStatus'),
  getUserProfile: (): Promise<UserProfile> => ipcRenderer.invoke('preferences.getUserProfile'),
  saveUserProfile: (profile: Partial<UserProfile>): Promise<UserProfile> => ipcRenderer.invoke('preferences.saveUserProfile', profile),
  importMatchFile: (sourceUrl?: string): Promise<SessionMatch | null> => ipcRenderer.invoke('matches.importFile', sourceUrl),
  resolveShooter: (sessionId: string, preferredName: string): Promise<ShooterResolution> => ipcRenderer.invoke('shooters.resolveForUser', sessionId, preferredName),
  pickExportFolder: (defaultPath?: string): Promise<string | null> => ipcRenderer.invoke('dialog.pickExportFolder', defaultPath),
  pickBackgroundImage: (defaultPath?: string): Promise<string | null> => ipcRenderer.invoke('dialog.pickBackgroundImage', defaultPath),
  previewOverlay: (sessionId: string, shooterId: string, selection: OverlayViewSelection, settings: OverlayRenderSettings): Promise<OverlayPreview> =>
    ipcRenderer.invoke('overlay.preview', sessionId, shooterId, selection, settings),
  exportOverlays: (sessionId: string, shooterId: string, options: OverlayExportOptions): Promise<OverlayExportResult> =>
    ipcRenderer.invoke('overlay.export', sessionId, shooterId, options),
  openExternalUrl: (targetUrl: string): Promise<void> => ipcRenderer.invoke('shell.openExternalUrl', targetUrl),
  openPath: (targetPath: string): Promise<string> => ipcRenderer.invoke('shell.openPath', targetPath),
  onSourceStatus: (listener: (status: SourceStatusEvent) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, status: SourceStatusEvent) => listener(status)
    ipcRenderer.on(SOURCE_STATUS_CHANNEL, wrappedListener)
    return () => {
      ipcRenderer.removeListener(SOURCE_STATUS_CHANNEL, wrappedListener)
    }
  }
})
