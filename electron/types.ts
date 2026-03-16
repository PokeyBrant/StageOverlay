export interface UserProfile {
  preferredShooterName: string
  preferredTheme: OverlayTheme
  preferredLayout: OverlayLayout
}

export type MatchSource = 'dashboard' | 'recent' | 'manual'
export type OverlayTheme = 'carbon' | 'sunset'
export type OverlayLayout = 'horizontal' | 'vertical'

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
  placement?: string
  division?: string
  className?: string
  powerFactor?: string
  stats: Record<string, string>
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
}

export interface ScrapedMatch {
  id: string
  sourceUrl: string
  resultsUrl: string
  name: string
  date?: string | null
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
  stageId: string
  imageDataUrl: string
}

export interface OverlayExportOptions {
  theme: OverlayTheme
  layout: OverlayLayout
}

export interface OverlayExportResult {
  outputDir: string
  files: string[]
}
