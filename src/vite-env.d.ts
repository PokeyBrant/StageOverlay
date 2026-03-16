/// <reference types="vite/client" />

import type { MatchReference, OverlayExportOptions, OverlayExportResult, OverlayPreview, OverlayTheme, SessionMatch, ShooterResolution, UserProfile } from '../electron/types'

interface ElectronAPI {
  openPractiScoreLogin: () => Promise<boolean>
  getUserProfile: () => Promise<UserProfile>
  saveUserProfile: (profile: Partial<UserProfile>) => Promise<UserProfile>
  fetchRecentMatches: () => Promise<MatchReference[]>
  importFromResultsUrl: (url: string) => Promise<SessionMatch>
  scrapeDetails: (matchRef: MatchReference) => Promise<SessionMatch>
  resolveShooter: (sessionId: string, preferredName: string) => Promise<ShooterResolution>
  previewOverlay: (sessionId: string, shooterId: string, stageId: string, layout: string, theme: OverlayTheme) => Promise<OverlayPreview>
  exportOverlays: (sessionId: string, shooterId: string, options: OverlayExportOptions) => Promise<OverlayExportResult>
  openPath: (targetPath: string) => Promise<string>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
