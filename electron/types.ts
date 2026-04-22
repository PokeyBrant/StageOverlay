export interface UserProfile {
  preferredShooterName: string
  preferredTheme: OverlayTheme
  preferredLayout: OverlayLayout
  preferredExportFolder: string
  backgroundSeed: string
  savedBackgroundSeed: string | null
  backgroundImagePath: string | null
  preferredCanvasPreset: OverlaySizePreset
  preferredCanvasWidth: number
  preferredCanvasHeight: number
  preferredAspectLock: boolean
}

export type MatchSource = 'dashboard' | 'recent' | 'manual'
export const overlayThemeIds = [
  'carbon',
  'sunset',
  'ocean',
  'ember',
  'forest',
  'midnight',
  'violet',
  'steel',
  'rose',
  'gold'
] as const
export type OverlayTheme = typeof overlayThemeIds[number]
export type OverlayLayout = 'horizontal' | 'vertical'
export type OverlayViewKind = 'match-summary' | 'stage-summary'
export type SourceStatusOperation = 'open-profile' | 'fetch-recent' | 'import-link' | 'load-match'
export type SourceStatusTone = 'idle' | 'working' | 'success' | 'error'
export type OverlaySizePreset = '1080p' | '1440p' | '4k' | 'custom'

export const overlaySizePresetLongestSide: Record<Exclude<OverlaySizePreset, 'custom'>, number> = {
  '1080p': 1080,
  '1440p': 1440,
  '4k': 2160
}

export const overlaySizePresetLabels: Record<OverlaySizePreset, string> = {
  '1080p': '1080p',
  '1440p': '1440p',
  '4k': '2160 / 4K',
  custom: 'Custom'
}

export interface SourceStatusEvent {
  operation: SourceStatusOperation
  phase: string
  headline: string
  detail: string
  tone: SourceStatusTone
  actionRequired: boolean
  browserVisible: boolean
}

export interface MatchDataProviderStatus {
  supportsFileImport: boolean
  headline: string
  detail: string
}

export interface OverlayViewSelection {
  kind: OverlayViewKind
  stageId?: string | null
}

export interface MatchReference {
  id: string
  name: string
  date: string | null
  source: MatchSource
  url: string
  resultsUrl?: string | null
}

export interface MatchStageResult {
  shooterName: string
  overallPlacement?: string
  divisionPlacement?: string | null
  division?: string | null
  className?: string
  powerFactor?: string
  stats: Record<string, string>
  divisionStats?: Record<string, string> | null
}

export interface MatchStage {
  id: string
  name: string
  order: number
  results: MatchStageResult[]
}

export interface MatchShooter {
  id: string
  name: string
  division: string | null
}

export interface MatchResultRow {
  shooterName: string
  overallPlacement?: string
  divisionPlacement?: string | null
  division?: string | null
  className?: string
  powerFactor?: string
  stats: Record<string, string>
  divisionStats?: Record<string, string> | null
}

export interface MatchData {
  id: string
  sourceUrl: string
  resultsUrl: string
  name: string
  date?: string | null
  matchResults: MatchResultRow[]
  stages: MatchStage[]
  shooters: MatchShooter[]
}

export interface SessionMatch {
  sessionId: string
  match: MatchData
}

export interface ShooterResolution {
  shooterId: string | null
  confidence: 'exact' | 'partial' | 'none'
  candidates: MatchShooter[]
}

export type ParsedStageResult = MatchStageResult
export type ParsedStage = MatchStage
export type ParsedShooter = MatchShooter
export type ParsedMatchResult = MatchResultRow
export type ParsedMatch = MatchData

export interface OverlayPreview {
  selectionId: string
  imageDataUrl: string
}

export interface OverlayRenderSettings {
  theme: OverlayTheme
  layout: OverlayLayout
  backgroundSeed: string
  backgroundImagePath?: string | null
  canvasWidth: number
  canvasHeight: number
}

export interface OverlayExportOptions extends OverlayRenderSettings {
  outputDir: string
  mode: 'all' | 'single'
  selection?: OverlayViewSelection | null
}

export interface OverlayExportResult {
  outputDir: string
  files: string[]
}
