/// <reference types="vite/client" />

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
} from '../electron/types'

interface ElectronAPI {
  getMatchDataProviderStatus: () => Promise<MatchDataProviderStatus>
  getUserProfile: () => Promise<UserProfile>
  saveUserProfile: (profile: Partial<UserProfile>) => Promise<UserProfile>
  importMatchFile: (sourceUrl?: string) => Promise<SessionMatch | null>
  resolveShooter: (sessionId: string, preferredName: string) => Promise<ShooterResolution>
  pickExportFolder: (defaultPath?: string) => Promise<string | null>
  pickBackgroundImage: (defaultPath?: string) => Promise<string | null>
  previewOverlay: (sessionId: string, shooterId: string, selection: OverlayViewSelection, settings: OverlayRenderSettings) => Promise<OverlayPreview>
  exportOverlays: (sessionId: string, shooterId: string, options: OverlayExportOptions) => Promise<OverlayExportResult>
  openExternalUrl: (targetUrl: string) => Promise<void>
  openPath: (targetPath: string) => Promise<string>
  onSourceStatus: (listener: (status: SourceStatusEvent) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
