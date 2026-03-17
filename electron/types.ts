export interface UserProfile {
  preferredShooterName: string
  preferredTheme: OverlayTheme
  preferredLayout: OverlayLayout
  preferredExportFolder: string
}

export type MatchSource = 'dashboard' | 'recent' | 'manual'
export type OverlayTheme = 'carbon' | 'sunset'
export type OverlayLayout = 'horizontal' | 'vertical'
export type OverlayViewKind = 'match-summary' | 'stage-summary'

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

export interface ScrapedStageResult {
  shooterName: string
  overallPlacement?: string
  divisionPlacement?: string | null
  division?: string | null
  className?: string
  powerFactor?: string
  stats: Record<string, string>
  divisionStats?: Record<string, string> | null
}

export interface ScrapedStage {
  id: string
  name: string
  order: number
  results: ScrapedStageResult[]
}

export interface ScrapedShooter {
  id: string
  name: string
  division: string | null
}

export interface ScrapedMatchResult {
  shooterName: string
  overallPlacement?: string
  divisionPlacement?: string | null
  division?: string | null
  className?: string
  powerFactor?: string
  stats: Record<string, string>
  divisionStats?: Record<string, string> | null
}

export interface ScrapedMatch {
  id: string
  sourceUrl: string
  resultsUrl: string
  name: string
  date?: string | null
  matchResults: ScrapedMatchResult[]
  stages: ScrapedStage[]
  shooters: ScrapedShooter[]
}

export interface SessionMatch {
  sessionId: string
  match: ScrapedMatch
}

export interface ShooterResolution {
  shooterId: string | null
  confidence: 'exact' | 'partial' | 'none'
  candidates: ScrapedShooter[]
}

export interface OverlayPreview {
  selectionId: string
  imageDataUrl: string
}

export interface OverlayExportOptions {
  theme: OverlayTheme
  layout: OverlayLayout
  outputDir: string
  mode: 'all' | 'single'
  selection?: OverlayViewSelection | null
}

export interface OverlayExportResult {
  outputDir: string
  files: string[]
}
