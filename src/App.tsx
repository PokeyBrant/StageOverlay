import { startTransition, useEffect, useState } from 'react'
import { overlaySizePresetLabels } from '../electron/types'
import {
  clampCanvasAxis,
  clampLockedLongestSide,
  detectCanvasPreset,
  freeCanvasAxisBounds,
  getCanvasLongestSide,
  getPresetCanvasDimensions,
  lockedLongestSideBounds,
  resolveCanvasDimensions,
  resolveLockedCanvasFromHeight,
  resolveLockedCanvasFromWidth
} from '../electron/renderSizing'
import type {
  MatchDataProviderStatus,
  OverlayLayout,
  OverlayRenderSettings,
  OverlaySizePreset,
  OverlayTheme,
  OverlayViewSelection,
  SessionMatch,
  SourceStatusEvent,
  SourceStatusTone,
  UserProfile
} from '../electron/types'

type Status = {
  tone: SourceStatusTone
  headline: string
  detail: string
  actionRequired: boolean
  browserVisible: boolean
}

const defaultStatus: Status = {
  tone: 'idle',
  headline: 'Ready',
  detail: 'Load match data, preview one shooter, and export match or stage overlays.',
  actionRequired: false,
  browserVisible: false
}

type PreviewOption = {
  id: string
  label: string
  group: string
  selection: OverlayViewSelection
}

type InlineOption<T extends string> = {
  value: T
  label: string
}

const themeOptions: InlineOption<OverlayTheme>[] = [
  { value: 'carbon', label: 'Carbon' },
  { value: 'sunset', label: 'Sunset' },
  { value: 'ocean', label: 'Ocean' },
  { value: 'ember', label: 'Ember' },
  { value: 'forest', label: 'Forest' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'violet', label: 'Violet' },
  { value: 'steel', label: 'Steel' },
  { value: 'rose', label: 'Rose' },
  { value: 'gold', label: 'Gold' }
]

const layoutOptions: InlineOption<OverlayLayout>[] = [
  { value: 'horizontal', label: 'Horizontal' },
  { value: 'vertical', label: 'Vertical' }
]

const outputPresetOptions: Array<{ preset: Exclude<OverlaySizePreset, 'custom'> }> = [
  { preset: '1080p' },
  { preset: '1440p' },
  { preset: '4k' }
]

function getSourceErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function normalizeSearchValue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function tokenizeSearchValue(value: string) {
  return normalizeSearchValue(value)
    .split(' ')
    .filter(Boolean)
}

function matchesShooterSearch(candidate: string, query: string) {
  const queryTokens = tokenizeSearchValue(query)
  if (queryTokens.length === 0) return true

  const candidateTokens = tokenizeSearchValue(candidate)
  return queryTokens.every((queryToken) => candidateTokens.some((candidateToken) => candidateToken.includes(queryToken)))
}

function buildPreviewOptions(sessionMatch: SessionMatch | null): PreviewOption[] {
  if (!sessionMatch) return []

  return [
    { id: 'match-summary', label: 'Match Summary', group: 'Match Summary', selection: { kind: 'match-summary' } },
    ...sessionMatch.match.stages.map((stage) => ({
      id: `stage-summary:${stage.id}`,
      label: `${stage.order}. ${stage.name}`,
      group: 'Stage Views',
      selection: { kind: 'stage-summary' as const, stageId: stage.id }
    }))
  ]
}

function buildLocalStatus(
  tone: SourceStatusTone,
  headline: string,
  detail: string,
  actionRequired = false,
  browserVisible = false
): Status {
  return {
    tone,
    headline,
    detail,
    actionRequired,
    browserVisible
  }
}

function buildSourceStatus(status: SourceStatusEvent): Status {
  return {
    tone: status.tone,
    headline: status.headline,
    detail: status.detail,
    actionRequired: status.actionRequired,
    browserVisible: status.browserVisible
  }
}

function createBackgroundSeed() {
  const randomPart = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)
  return `theme-${randomPart}`
}

function normalizeBackgroundSeed(value: string) {
  return value.trim() || 'stageoverlay-default'
}

function formatCanvasDimensions(width: number, height: number) {
  return `${width} x ${height}`
}

function normalizeSavedSeed(value: string | null | undefined) {
  return value?.trim() ? value.trim() : null
}

function parseCanvasInput(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function fileNameFromPath(value: string | null) {
  if (!value) {
    return 'No image selected'
  }

  return value.replace(/^.*[\\/]/, '')
}

export default function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [preferredName, setPreferredName] = useState('')
  const [resultsUrl, setResultsUrl] = useState('')
  const [sessionMatch, setSessionMatch] = useState<SessionMatch | null>(null)
  const [selectedShooterId, setSelectedShooterId] = useState<string | null>(null)
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>('match-summary')
  const [selectedTheme, setSelectedTheme] = useState<OverlayTheme>('carbon')
  const [selectedLayout, setSelectedLayout] = useState<OverlayLayout>('horizontal')
  const [backgroundSeed, setBackgroundSeed] = useState('stageoverlay-default')
  const [savedBackgroundSeed, setSavedBackgroundSeed] = useState<string | null>(null)
  const [backgroundImagePath, setBackgroundImagePath] = useState<string | null>(null)
  const [canvasPreset, setCanvasPreset] = useState<OverlaySizePreset>('1080p')
  const [aspectLock, setAspectLock] = useState(true)
  const [canvasWidth, setCanvasWidth] = useState(1080)
  const [canvasHeight, setCanvasHeight] = useState(324)
  const [canvasWidthInput, setCanvasWidthInput] = useState('1080')
  const [canvasHeightInput, setCanvasHeightInput] = useState('324')
  const [exportFolder, setExportFolder] = useState('')
  const [exportAllOverlays, setExportAllOverlays] = useState(true)
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null)
  const [exportPath, setExportPath] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>(defaultStatus)
  const [providerStatus, setProviderStatus] = useState<MatchDataProviderStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [shooterSearch, setShooterSearch] = useState('')
  const [showShooterSuggestions, setShowShooterSuggestions] = useState(false)
  const [openSetupDropdown, setOpenSetupDropdown] = useState<'theme' | 'layout' | null>(null)

  function applyCanvasState(width: number, height: number, nextPreset: OverlaySizePreset, nextAspectLock: boolean) {
    setCanvasWidth(width)
    setCanvasHeight(height)
    setCanvasWidthInput(String(width))
    setCanvasHeightInput(String(height))
    setCanvasPreset(nextPreset)
    setAspectLock(nextAspectLock)
  }

  function applyUserProfile(nextProfile: UserProfile) {
    const normalizedSavedSeed = normalizeSavedSeed(nextProfile.savedBackgroundSeed)
    setProfile(nextProfile)
    setPreferredName(nextProfile.preferredShooterName)
    setSelectedTheme(nextProfile.preferredTheme)
    setSelectedLayout(nextProfile.preferredLayout)
    setExportFolder(nextProfile.preferredExportFolder)
    setBackgroundSeed(normalizeBackgroundSeed(nextProfile.backgroundSeed))
    setSavedBackgroundSeed(normalizedSavedSeed)
    setBackgroundImagePath(nextProfile.backgroundImagePath)
    applyCanvasState(
      nextProfile.preferredCanvasWidth,
      nextProfile.preferredCanvasHeight,
      nextProfile.preferredCanvasPreset,
      nextProfile.preferredAspectLock
    )
  }

  async function refreshProviderStatus() {
    try {
      setProviderStatus(await window.electronAPI.getMatchDataProviderStatus())
    } catch {
      setProviderStatus(null)
    }
  }

  useEffect(() => {
    void window.electronAPI.getUserProfile().then((value) => {
      const initialCanvasWidth = value.preferredCanvasWidth || 1080
      const initialCanvasHeight = value.preferredCanvasHeight || 324
      applyUserProfile({
        ...value,
        backgroundSeed: normalizeBackgroundSeed(value.backgroundSeed),
        savedBackgroundSeed: normalizeSavedSeed(value.savedBackgroundSeed),
        preferredCanvasPreset: value.preferredCanvasPreset || detectCanvasPreset(value.preferredLayout, initialCanvasWidth, initialCanvasHeight),
        preferredCanvasWidth: initialCanvasWidth,
        preferredCanvasHeight: initialCanvasHeight,
        preferredAspectLock: value.preferredAspectLock ?? true
      })
    })
    void refreshProviderStatus()
  }, [])

  useEffect(() => {
    return window.electronAPI.onSourceStatus((nextStatus) => {
      setStatus(buildSourceStatus(nextStatus))
    })
  }, [])

  const previewSettings: OverlayRenderSettings = {
    layout: selectedLayout,
    theme: selectedTheme,
    backgroundSeed: normalizeBackgroundSeed(backgroundSeed),
    backgroundImagePath,
    canvasWidth,
    canvasHeight
  }

  useEffect(() => {
    if (!sessionMatch || !selectedShooterId) return
    const previewOptions = buildPreviewOptions(sessionMatch)
    const activePreview = previewOptions.find((option) => option.id === selectedPreviewId) ?? previewOptions[0]
    if (!activePreview) return

    startTransition(() => {
      void window.electronAPI
        .previewOverlay(sessionMatch.sessionId, selectedShooterId, activePreview.selection, previewSettings)
        .then((preview) => {
          setSelectedPreviewId(preview.selectionId)
          setPreviewDataUrl(preview.imageDataUrl)
        })
        .catch((error: Error) => {
          setStatus(buildLocalStatus('error', 'Preview failed', error.message))
        })
    })
  }, [sessionMatch, selectedShooterId, selectedPreviewId, selectedLayout, selectedTheme, backgroundSeed, backgroundImagePath, canvasWidth, canvasHeight])

  async function persistProfile(overrides: Partial<UserProfile> = {}) {
    const saved = await window.electronAPI.saveUserProfile({
      preferredShooterName: overrides.preferredShooterName ?? preferredName,
      preferredTheme: overrides.preferredTheme ?? selectedTheme,
      preferredLayout: overrides.preferredLayout ?? selectedLayout,
      preferredExportFolder: overrides.preferredExportFolder ?? exportFolder,
      backgroundSeed: normalizeBackgroundSeed(overrides.backgroundSeed ?? backgroundSeed),
      savedBackgroundSeed: overrides.savedBackgroundSeed === undefined ? savedBackgroundSeed : normalizeSavedSeed(overrides.savedBackgroundSeed),
      backgroundImagePath: overrides.backgroundImagePath === undefined ? backgroundImagePath : overrides.backgroundImagePath,
      preferredCanvasPreset: overrides.preferredCanvasPreset ?? canvasPreset,
      preferredCanvasWidth: overrides.preferredCanvasWidth ?? canvasWidth,
      preferredCanvasHeight: overrides.preferredCanvasHeight ?? canvasHeight,
      preferredAspectLock: overrides.preferredAspectLock ?? aspectLock
    })
    applyUserProfile(saved)
    return saved
  }

  async function handleImportMatchFile() {
    if (!providerStatus?.supportsFileImport) {
      setStatus(buildLocalStatus('error', 'Match file import unavailable', 'This build does not include match file import.'))
      return
    }
    setBusy(true)
    setStatus(buildLocalStatus('working', 'Choose match file', 'Choose a saved match page file to import.'))
    try {
      await persistProfile()
      const nextSession = await window.electronAPI.importMatchFile(resultsUrl.trim() || undefined)
      if (!nextSession) {
        setStatus(defaultStatus)
        return
      }

      await applySessionMatch(nextSession)
      setStatus(buildLocalStatus('success', `Loaded ${nextSession.match.name}`, 'Loaded match statistics from the imported file.'))
    } catch (error) {
      setStatus(buildLocalStatus('error', 'Match file import failed', (error as Error).message))
    } finally {
      setBusy(false)
    }
  }

  async function applySessionMatch(nextSession: SessionMatch) {
    setSessionMatch(nextSession)
    setPreviewDataUrl(null)
    setExportPath(null)
    const resolution = await window.electronAPI.resolveShooter(nextSession.sessionId, preferredName)
    setSelectedShooterId(resolution.shooterId)
    setSelectedPreviewId('match-summary')
    const resolvedShooter = nextSession.match.shooters.find((shooter) => shooter.id === resolution.shooterId) ?? null
    setShooterSearch(resolvedShooter?.name ?? preferredName)
  }

  async function handleExport() {
    if (!sessionMatch || !selectedShooterId) return
    const activePreview = previewOptions.find((option) => option.id === selectedPreviewId) ?? previewOptions[0] ?? null
    if (!exportFolder.trim()) {
      setStatus(buildLocalStatus('error', 'Export folder required', 'Choose an export folder before exporting overlays.'))
      return
    }
    if (!exportAllOverlays && !activePreview) {
      setStatus(buildLocalStatus('error', 'Preview selection required', 'Select a preview overlay before exporting a single PNG.'))
      return
    }

    setBusy(true)
    setStatus(buildLocalStatus('working', exportAllOverlays ? 'Exporting all overlays' : 'Exporting selected overlay', exportAllOverlays ? 'Exporting all overlay PNGs.' : 'Exporting the selected overlay PNG.'))
    try {
      await persistProfile()
      const result = await window.electronAPI.exportOverlays(sessionMatch.sessionId, selectedShooterId, {
        ...previewSettings,
        outputDir: exportFolder.trim(),
        mode: exportAllOverlays ? 'all' : 'single',
        selection: exportAllOverlays ? null : activePreview?.selection ?? null
      })
      setExportPath(result.outputDir)
      setStatus(buildLocalStatus('success', 'Overlay export complete', exportAllOverlays ? `Exported ${result.files.length} overlays.` : `Exported ${result.files.length} overlay.`))
    } catch (error) {
      setStatus(buildLocalStatus('error', 'Overlay export failed', getSourceErrorMessage(error)))
    } finally {
      setBusy(false)
    }
  }

  const shooters = sessionMatch?.match.shooters ?? []
  const selectedShooter = shooters.find((shooter) => shooter.id === selectedShooterId) ?? null
  const filteredShooters = shooters.filter((shooter) => matchesShooterSearch(shooter.name, shooterSearch))
  const previewOptions = buildPreviewOptions(sessionMatch)
  const activeMatchName = sessionMatch?.match.name || 'No match selected'
  const providerNotice = providerStatus
  const canExport = Boolean(sessionMatch && selectedShooterId && exportFolder.trim())
  const currentLongestSide = getCanvasLongestSide(canvasWidth, canvasHeight)
  const previewGroups = previewOptions.reduce<Map<string, PreviewOption[]>>((groups, option) => {
    const entries = groups.get(option.group) ?? []
    entries.push(option)
    groups.set(option.group, entries)
    return groups
  }, new Map())

  function handleSelectShooter(shooterId: string) {
    const shooter = shooters.find((candidate) => candidate.id === shooterId) ?? null
    setSelectedShooterId(shooterId)
    setShooterSearch(shooter?.name ?? '')
    setShowShooterSuggestions(false)
  }

  async function handleChooseExportFolder() {
    const chosenFolder = await window.electronAPI.pickExportFolder(exportFolder)
    if (!chosenFolder) return

    setExportFolder(chosenFolder)
    await persistProfile({ preferredExportFolder: chosenFolder })
  }

  async function handleChooseBackgroundImage() {
    const chosenPath = await window.electronAPI.pickBackgroundImage(backgroundImagePath ?? undefined)
    if (!chosenPath) return

    setBackgroundImagePath(chosenPath)
    await persistProfile({ backgroundImagePath: chosenPath })
  }

  async function handleClearBackgroundImage() {
    setBackgroundImagePath(null)
    await persistProfile({ backgroundImagePath: null })
  }

  async function handleSelectTheme(nextTheme: OverlayTheme) {
    setSelectedTheme(nextTheme)
    setOpenSetupDropdown(null)
    await persistProfile({ preferredTheme: nextTheme })
  }

  async function handleSelectLayout(nextLayout: OverlayLayout) {
    let nextWidth = canvasWidth
    let nextHeight = canvasHeight
    let nextPreset = canvasPreset
    if (aspectLock) {
      if (canvasPreset !== 'custom') {
        const presetDimensions = getPresetCanvasDimensions(nextLayout, canvasPreset)
        nextWidth = presetDimensions.width
        nextHeight = presetDimensions.height
      } else {
        const lockedDimensions = resolveCanvasDimensions(nextLayout, getCanvasLongestSide(canvasWidth, canvasHeight))
        nextWidth = lockedDimensions.width
        nextHeight = lockedDimensions.height
      }
      nextPreset = detectCanvasPreset(nextLayout, nextWidth, nextHeight)
      applyCanvasState(nextWidth, nextHeight, nextPreset, aspectLock)
    }
    setSelectedLayout(nextLayout)
    setOpenSetupDropdown(null)
    await persistProfile({
      preferredLayout: nextLayout,
      preferredCanvasWidth: nextWidth,
      preferredCanvasHeight: nextHeight,
      preferredCanvasPreset: nextPreset
    })
  }

  async function handleBackgroundSeedBlur() {
    const normalized = normalizeBackgroundSeed(backgroundSeed)
    setBackgroundSeed(normalized)
    await persistProfile({ backgroundSeed: normalized })
  }

  async function handleSaveBackgroundSeed() {
    const normalized = normalizeBackgroundSeed(backgroundSeed)
    setBackgroundSeed(normalized)
    setSavedBackgroundSeed(normalized)
    await persistProfile({
      backgroundSeed: normalized,
      savedBackgroundSeed: normalized
    })
  }

  async function handleLoadSavedBackgroundSeed() {
    if (!savedBackgroundSeed) return

    setBackgroundSeed(savedBackgroundSeed)
    await persistProfile({ backgroundSeed: savedBackgroundSeed })
  }

  async function handleRandomizeBackground() {
    const nextSeed = createBackgroundSeed()
    setBackgroundSeed(nextSeed)
    await persistProfile({ backgroundSeed: nextSeed })
  }

  async function handleSelectCanvasPreset(nextPreset: Exclude<OverlaySizePreset, 'custom'>) {
    const nextDimensions = getPresetCanvasDimensions(selectedLayout, nextPreset)
    applyCanvasState(nextDimensions.width, nextDimensions.height, nextPreset, aspectLock)
    await persistProfile({
      preferredCanvasPreset: nextPreset,
      preferredCanvasWidth: nextDimensions.width,
      preferredCanvasHeight: nextDimensions.height
    })
  }

  function handleCanvasWidthChange(value: string) {
    setCanvasWidthInput(value)
  }

  async function commitCanvasWidth() {
    const parsedWidth = parseCanvasInput(canvasWidthInput, canvasWidth)
    const nextDimensions = aspectLock
      ? resolveLockedCanvasFromWidth(selectedLayout, parsedWidth)
      : {
          width: clampCanvasAxis(parsedWidth),
          height: canvasHeight
        }
    const nextPreset = detectCanvasPreset(selectedLayout, nextDimensions.width, nextDimensions.height)
    applyCanvasState(nextDimensions.width, nextDimensions.height, nextPreset, aspectLock)
    await persistProfile({
      preferredCanvasWidth: nextDimensions.width,
      preferredCanvasHeight: nextDimensions.height,
      preferredCanvasPreset: nextPreset
    })
  }

  function handleCanvasHeightChange(value: string) {
    setCanvasHeightInput(value)
  }

  async function commitCanvasHeight() {
    const parsedHeight = parseCanvasInput(canvasHeightInput, canvasHeight)
    const nextDimensions = aspectLock
      ? resolveLockedCanvasFromHeight(selectedLayout, parsedHeight)
      : {
          width: canvasWidth,
          height: clampCanvasAxis(parsedHeight)
        }
    const nextPreset = detectCanvasPreset(selectedLayout, nextDimensions.width, nextDimensions.height)
    applyCanvasState(nextDimensions.width, nextDimensions.height, nextPreset, aspectLock)
    await persistProfile({
      preferredCanvasWidth: nextDimensions.width,
      preferredCanvasHeight: nextDimensions.height,
      preferredCanvasPreset: nextPreset
    })
  }

  async function handleAspectLockChange(nextAspectLock: boolean) {
    if (!nextAspectLock) {
      setAspectLock(false)
      await persistProfile({ preferredAspectLock: false })
      return
    }

    const lockedDimensions = resolveCanvasDimensions(selectedLayout, getCanvasLongestSide(canvasWidth, canvasHeight))
    const nextPreset = detectCanvasPreset(selectedLayout, lockedDimensions.width, lockedDimensions.height)
    applyCanvasState(lockedDimensions.width, lockedDimensions.height, nextPreset, true)
    await persistProfile({
      preferredAspectLock: true,
      preferredCanvasWidth: lockedDimensions.width,
      preferredCanvasHeight: lockedDimensions.height,
      preferredCanvasPreset: nextPreset
    })
  }

  function handleLongestSideChange(nextLongestSide: number) {
    const nextDimensions = resolveCanvasDimensions(selectedLayout, nextLongestSide)
    const nextPreset = detectCanvasPreset(selectedLayout, nextDimensions.width, nextDimensions.height)
    applyCanvasState(nextDimensions.width, nextDimensions.height, nextPreset, aspectLock)
  }

  async function commitLongestSide(nextLongestSide = getCanvasLongestSide(canvasWidth, canvasHeight)) {
    const normalizedLongestSide = clampLockedLongestSide(nextLongestSide)
    const nextDimensions = resolveCanvasDimensions(selectedLayout, normalizedLongestSide)
    const nextPreset = detectCanvasPreset(selectedLayout, nextDimensions.width, nextDimensions.height)
    applyCanvasState(nextDimensions.width, nextDimensions.height, nextPreset, aspectLock)
    await persistProfile({
      preferredCanvasPreset: nextPreset,
      preferredCanvasWidth: nextDimensions.width,
      preferredCanvasHeight: nextDimensions.height
    })
  }

  function renderInlineDropdown<T extends string>(
    id: 'theme' | 'layout',
    value: T,
    options: InlineOption<T>[],
    onSelect: (nextValue: T) => Promise<void>
  ) {
    const selectedOption = options.find((option) => option.value === value) ?? options[0]
    const isOpen = openSetupDropdown === id

    return (
      <div
        className={`inline-dropdown ${isOpen ? 'open' : ''}`}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setOpenSetupDropdown((current) => (current === id ? null : current))
          }
        }}
      >
        <button
          className="inline-dropdown-trigger"
          type="button"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          onClick={() => setOpenSetupDropdown((current) => (current === id ? null : id))}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpenSetupDropdown(null)
            }
          }}
        >
          <span>{selectedOption?.label ?? value}</span>
          <span className="inline-dropdown-caret" aria-hidden="true">▾</span>
        </button>
        {isOpen && (
          <div className="inline-dropdown-menu" role="listbox">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`inline-dropdown-option ${option.value === value ? 'active' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void onSelect(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Stateless Match Overlay Builder</p>
          <h1>Load scores. Export overlay graphics.</h1>
          <p className="subtitle">
            Bring match results into the app, preview one shooter at a time, and export PNGs for your video workflow.
          </p>
        </div>
        <div className={`status-card ${status.tone}`}>
          <div className="status-card-head">
            <div className="status-card-title-row">
              {status.tone === 'working' && <span className="status-spinner" aria-hidden="true" />}
              <strong>{status.headline}</strong>
            </div>
            <div className="status-badges">
              {status.tone === 'working' && !status.browserVisible && !status.actionRequired && (
                <span className="status-badge">Running in background</span>
              )}
              {status.actionRequired && (
                <span className="status-badge attention">Action needed while loading match data</span>
              )}
            </div>
          </div>
          <p className="status-detail">{status.detail}</p>
        </div>
      </section>

      <div className="workflow-sections">
        <section className="panel workflow-panel workflow-step step-1">
          <div className="workflow-head">
            <h2>1. Shooter Profile</h2>
            <p className="section-intro">Set your preferred shooter name so the imported match can usually preselect the correct shooter automatically.</p>
          </div>

          <label className="field">
            <span>Preferred shooter name</span>
            <input
              value={preferredName}
              onChange={(event) => setPreferredName(event.target.value)}
              onBlur={(event) => void persistProfile({ preferredShooterName: event.currentTarget.value })}
              placeholder="John Smith"
            />
          </label>
          <p className="selection-meta">StageOverlay uses this name to preselect your shooter after a match loads.</p>

          {providerNotice ? (
            <div className="trusted-profile-hint ready">
              <strong>{providerNotice.headline}</strong>
              <p>{providerNotice.detail}</p>
            </div>
          ) : null}
        </section>

        <section className="panel workflow-panel workflow-step step-2">
          <div className="workflow-head">
            <h2>2. Import Match Data</h2>
            <p className="section-intro">Import one saved match page file to bring a single match into this session.</p>
          </div>

          <div className="source-choice-grid">
            <div className="source-choice-card">
              <p className="section-kicker">Match File</p>
              <h3>Import Saved Match Page</h3>
              <p className="choice-copy">Use a match page file you already saved or exported locally, then load it into the current session for preview and export.</p>

              <div className="url-form">
                <label className="field">
                  <span>Optional source link</span>
                  <input
                    value={resultsUrl}
                    onChange={(event) => setResultsUrl(event.target.value)}
                    placeholder="https://example.com/match-page"
                  />
                </label>
              </div>

              <div className="source-actions">
                <button className="secondary-btn" type="button" onClick={() => void handleImportMatchFile()} disabled={busy || !providerStatus?.supportsFileImport}>
                  Import Match File
                </button>
              </div>
              <p className="selection-meta">
                Save or export the fully loaded match page from your normal browser or local source, then import that file here.
              </p>
            </div>
          </div>
        </section>

        <section className="panel workflow-panel workflow-step step-3">
          <div className="panel-head workflow-panel-head">
            <div>
              <h2>3. Imported Match</h2>
              <p className="section-intro">Review the currently loaded match before choosing the shooter in section 4.</p>
            </div>
            <span>{sessionMatch ? 'Loaded' : 'Waiting'}</span>
          </div>
          <div className="match-list">
            {sessionMatch ? (
              <div className="match-card">
                <strong>{sessionMatch.match.name}</strong>
                <span>{sessionMatch.match.date || 'No date available'}</span>
                <span className="match-source">
                  {sessionMatch.match.shooters.length} shooters loaded, {sessionMatch.match.stages.length} stages loaded
                </span>
              </div>
            ) : (
              <p className="empty-state">Import a match file in section 2 to load the current session.</p>
            )}
          </div>
        </section>

        <section className="panel workflow-panel workflow-step step-4">
          <div className="panel-head workflow-panel-head">
            <div>
              <h2>4. Select Shooter</h2>
              <p className="section-intro">Choose the shooter whose stats should drive the preview and exported overlays.</p>
              <p className="selection-meta section-note">If you already saved your shooter name in section 1, StageOverlay should usually find and select that shooter automatically after the match loads.</p>
            </div>
            <span>{activeMatchName}</span>
          </div>

          {sessionMatch ? (
            <>
              <label className="field">
                <span>Focus shooter</span>
                <div className="searchable-picker">
                  <input
                    value={shooterSearch}
                    onChange={(event) => {
                      setShooterSearch(event.target.value)
                      setShowShooterSuggestions(true)
                    }}
                    onFocus={() => setShowShooterSuggestions(true)}
                    onBlur={() => {
                      window.setTimeout(() => setShowShooterSuggestions(false), 120)
                    }}
                    placeholder="Search shooter by name"
                  />
                  {showShooterSuggestions && (
                    <div className="picker-results">
                      {filteredShooters.length > 0 ? (
                        filteredShooters.map((shooter) => (
                          <button
                            key={shooter.id}
                            className={`picker-option ${selectedShooterId === shooter.id ? 'active' : ''}`}
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault()
                              handleSelectShooter(shooter.id)
                            }}
                          >
                            <strong>{shooter.name}</strong>
                            <span>{shooter.division || 'Division unknown'}</span>
                          </button>
                        ))
                      ) : (
                        <p className="empty-state picker-empty">No shooters match that search.</p>
                      )}
                    </div>
                  )}
                </div>
              </label>
              <p className="selection-meta">
                {selectedShooter
                  ? `Detected division: ${selectedShooter.division || 'Not found on results page'}`
                  : 'No automatic shooter match found. Search to choose the correct shooter.'}
              </p>
            </>
          ) : (
            <p className="empty-state">Load a match first, then choose the correct shooter for this session.</p>
          )}
        </section>

        <section className="panel workflow-panel workflow-step step-5">
          <div className="panel-head workflow-panel-head">
            <div>
              <h2>5. Preview + Export</h2>
              <p className="section-intro">Adjust style, background, output size, and export settings before generating the final PNGs.</p>
            </div>
            <span>{activeMatchName}</span>
          </div>

          <div className="preview-export-layout">
            <div className="preview-export-controls">
              <div className="settings-group">
                <div className="settings-group-head">
                  <h3>Style</h3>
                  <p className="choice-copy">Keep the same palette and layout style while changing the current background seed. Save one favorite seed if you want to come back to it later.</p>
                </div>
                <div className="settings-grid">
                  <label className="field compact">
                    <span>Theme</span>
                    {renderInlineDropdown('theme', selectedTheme, themeOptions, handleSelectTheme)}
                  </label>

                  <label className="field compact">
                    <span>Layout</span>
                    {renderInlineDropdown('layout', selectedLayout, layoutOptions, handleSelectLayout)}
                  </label>
                </div>
                <div className="seed-control-row">
                  <label className="field compact seed-field">
                    <span>Background seed</span>
                    <input
                      value={backgroundSeed}
                      onChange={(event) => setBackgroundSeed(event.target.value)}
                      onBlur={() => void handleBackgroundSeedBlur()}
                      placeholder="theme-seed"
                    />
                  </label>
                  <button className="secondary-btn seed-action" type="button" onClick={() => void handleRandomizeBackground()}>
                    Randomize Background
                  </button>
                </div>
                <div className="source-actions">
                  <button className="secondary-btn" type="button" onClick={() => void handleSaveBackgroundSeed()}>
                    Save Current Seed
                  </button>
                  <button className="secondary-btn" type="button" onClick={() => void handleLoadSavedBackgroundSeed()} disabled={!savedBackgroundSeed}>
                    Load Saved Seed
                  </button>
                </div>
                <p className="selection-meta">
                  {savedBackgroundSeed
                    ? `Saved favorite seed: ${savedBackgroundSeed}`
                    : 'No saved favorite seed yet.'}
                </p>
              </div>

              <div className="settings-group">
                <div className="settings-group-head">
                  <h3>Background</h3>
                  <p className="choice-copy">Use the procedural theme background or replace it with a static image you provide.</p>
                </div>
                <div className="background-mode-card">
                  <p className="selection-meta background-mode-meta">
                    {backgroundImagePath
                      ? `Static background active: ${fileNameFromPath(backgroundImagePath)}`
                      : 'Generated theme background active.'}
                  </p>
                  <div className="source-actions">
                    <button className="secondary-btn" type="button" onClick={() => void handleChooseBackgroundImage()}>
                      Choose Background Image
                    </button>
                    <button className="secondary-btn" type="button" onClick={() => void handleClearBackgroundImage()} disabled={!backgroundImagePath}>
                      Clear Image
                    </button>
                  </div>
                  <p className="selection-meta">PNG, JPG, WEBP, and SVG files are supported. Uploaded images replace the generated background while keeping the theme colors for the overlay content.</p>
                </div>
              </div>

              <div className="settings-group">
                <div className="settings-group-head">
                  <h3>Output Size</h3>
                  <p className="choice-copy">Choose a preset, then fine-tune width and height. Keep aspect lock on for normal layout ratios, or turn it off for skinny custom canvases.</p>
                </div>
                <div className="preset-toggle-row">
                  {outputPresetOptions.map((option) => (
                    <button
                      key={option.preset}
                      type="button"
                      className={`preset-toggle ${canvasPreset === option.preset ? 'active' : ''}`}
                      onClick={() => void handleSelectCanvasPreset(option.preset)}
                    >
                      {overlaySizePresetLabels[option.preset]}
                    </button>
                  ))}
                  <span className={`preset-toggle static ${canvasPreset === 'custom' ? 'active' : ''}`}>Custom</span>
                </div>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={aspectLock}
                    onChange={(event) => void handleAspectLockChange(event.target.checked)}
                  />
                  <span>Lock aspect ratio to the selected layout</span>
                </label>
                <div className="settings-grid canvas-size-grid">
                  <label className="field compact">
                    <span>Canvas width</span>
                    <input
                      type="number"
                      min={freeCanvasAxisBounds.min}
                      max={freeCanvasAxisBounds.max}
                      step="10"
                      value={canvasWidthInput}
                      onChange={(event) => handleCanvasWidthChange(event.target.value)}
                      onBlur={() => void commitCanvasWidth()}
                    />
                  </label>
                  <label className="field compact">
                    <span>Canvas height</span>
                    <input
                      type="number"
                      min={freeCanvasAxisBounds.min}
                      max={freeCanvasAxisBounds.max}
                      step="10"
                      value={canvasHeightInput}
                      onChange={(event) => handleCanvasHeightChange(event.target.value)}
                      onBlur={() => void commitCanvasHeight()}
                    />
                  </label>
                </div>
                {aspectLock ? (
                  <label className="field">
                    <span>Longest side: {currentLongestSide}px</span>
                    <input
                      className="range-slider"
                      type="range"
                      min={lockedLongestSideBounds.min}
                      max={lockedLongestSideBounds.max}
                      step="60"
                      value={currentLongestSide}
                      onChange={(event) => handleLongestSideChange(Number(event.target.value))}
                      onMouseUp={() => void commitLongestSide()}
                      onTouchEnd={() => void commitLongestSide()}
                      onKeyUp={() => void commitLongestSide()}
                    />
                  </label>
                ) : (
                  <p className="selection-meta">Longest-side slider is available only while aspect lock is enabled.</p>
                )}
                <p className="selection-meta">
                  Current canvas: {formatCanvasDimensions(canvasWidth, canvasHeight)}. Preset state: {overlaySizePresetLabels[canvasPreset]}.
                </p>
              </div>

              <div className="settings-group">
                <div className="settings-group-head">
                  <h3>Preview + Export</h3>
                  <p className="choice-copy">Choose the current overlay view, confirm the export folder, then render one PNG or the full overlay set.</p>
                </div>
                <label className="field">
                  <span>Preview overlay</span>
                  <select
                    className="preview-overlay-select"
                    value={sessionMatch ? (selectedPreviewId ?? '') : ''}
                    onChange={(event) => setSelectedPreviewId(event.target.value || null)}
                    disabled={!sessionMatch}
                  >
                    {!sessionMatch && <option value="">Load a match first</option>}
                    {Array.from(previewGroups.entries()).map(([group, options]) => (
                      <optgroup key={group} label={group}>
                        {options.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Export folder</span>
                  <div className="folder-picker-row">
                    <input value={exportFolder} readOnly placeholder="Choose a folder for exported overlays" />
                    <button className="secondary-btn" type="button" onClick={() => void handleChooseExportFolder()}>
                      Choose Folder
                    </button>
                  </div>
                </label>

                {!sessionMatch && <p className="selection-meta">Load a match in section 2, then confirm the shooter in section 4 before exporting overlays.</p>}

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={exportAllOverlays}
                    onChange={(event) => setExportAllOverlays(event.target.checked)}
                    disabled={!sessionMatch}
                  />
                  <span>Export all overlays</span>
                </label>

                <div className="export-actions">
                  <button className="primary-btn" onClick={() => void handleExport()} disabled={busy || !canExport}>
                    {exportAllOverlays ? 'Export All Overlay PNGs' : 'Export Preview Overlay PNG'}
                  </button>
                  {exportPath && (
                    <button className="secondary-btn" onClick={() => void window.electronAPI.openPath(exportPath)}>
                      Open Export Folder
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="preview-stage">
              {selectedShooter && <p className="selection-meta preview-meta">Previewing {selectedShooter.name}</p>}
              <p className="selection-meta preview-meta">Render size: {formatCanvasDimensions(canvasWidth, canvasHeight)}</p>
              {previewDataUrl ? (
                <img className="preview-image" src={previewDataUrl} alt="Overlay preview" />
              ) : sessionMatch && !selectedShooterId ? (
                <p className="empty-state">Select a shooter in section 4 to generate the overlay preview.</p>
              ) : sessionMatch ? (
                <p className="empty-state">Preview appears here after the selected overlay view is generated.</p>
              ) : (
                <p className="empty-state">Preview appears here once a match and shooter are selected.</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
