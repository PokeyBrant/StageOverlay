import { startTransition, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { MatchReference, OverlayLayout, OverlayTheme, OverlayViewSelection, SessionMatch, UserProfile } from '../electron/types'

type Status = {
  tone: 'idle' | 'success' | 'error'
  message: string
}

const defaultStatus: Status = { tone: 'idle', message: 'Authenticate, pick a source, and export match or stage overlays.' }

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
  { value: 'sunset', label: 'Sunset' }
]

const layoutOptions: InlineOption<OverlayLayout>[] = [
  { value: 'horizontal', label: 'Horizontal' },
  { value: 'vertical', label: 'Vertical' }
]

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

function toPreviewOptionId(selection: OverlayViewSelection) {
  if (selection.kind.startsWith('stage-') && selection.stageId) {
    return `${selection.kind}:${selection.stageId}`
  }
  return selection.kind
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

export default function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [preferredName, setPreferredName] = useState('')
  const [resultsUrl, setResultsUrl] = useState('')
  const [recentMatches, setRecentMatches] = useState<MatchReference[]>([])
  const [loadingRecent, setLoadingRecent] = useState(false)
  const [sessionMatch, setSessionMatch] = useState<SessionMatch | null>(null)
  const [selectedShooterId, setSelectedShooterId] = useState<string | null>(null)
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>('match-summary')
  const [selectedTheme, setSelectedTheme] = useState<OverlayTheme>('carbon')
  const [selectedLayout, setSelectedLayout] = useState<OverlayLayout>('horizontal')
  const [exportFolder, setExportFolder] = useState('')
  const [exportAllOverlays, setExportAllOverlays] = useState(true)
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null)
  const [exportPath, setExportPath] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>(defaultStatus)
  const [busy, setBusy] = useState(false)
  const [shooterSearch, setShooterSearch] = useState('')
  const [showShooterSuggestions, setShowShooterSuggestions] = useState(false)
  const [openSetupDropdown, setOpenSetupDropdown] = useState<'theme' | 'layout' | null>(null)

  useEffect(() => {
    void window.electronAPI.getUserProfile().then((value) => {
      setProfile(value)
      setPreferredName(value.preferredShooterName)
      setSelectedTheme(value.preferredTheme)
      setSelectedLayout(value.preferredLayout)
      setExportFolder(value.preferredExportFolder)
    })
  }, [])

  useEffect(() => {
    if (!sessionMatch || !selectedShooterId) return
    const previewOptions = buildPreviewOptions(sessionMatch)
    const activePreview = previewOptions.find((option) => option.id === selectedPreviewId) ?? previewOptions[0]
    if (!activePreview) return

    startTransition(() => {
      void window.electronAPI
        .previewOverlay(sessionMatch.sessionId, selectedShooterId, activePreview.selection, selectedLayout, selectedTheme)
        .then((preview) => {
          setSelectedPreviewId(preview.selectionId)
          setPreviewDataUrl(preview.imageDataUrl)
        })
        .catch((error: Error) => {
          setStatus({ tone: 'error', message: error.message })
        })
    })
  }, [sessionMatch, selectedShooterId, selectedPreviewId, selectedLayout, selectedTheme])

  async function persistProfile(
    nextName = preferredName,
    nextTheme = selectedTheme,
    nextLayout = selectedLayout,
    nextExportFolder = exportFolder
  ) {
    const saved = await window.electronAPI.saveUserProfile({
      preferredShooterName: nextName,
      preferredTheme: nextTheme,
      preferredLayout: nextLayout,
      preferredExportFolder: nextExportFolder
    })
    setProfile(saved)
    setExportFolder(saved.preferredExportFolder)
  }

  async function handleOpenLogin() {
    setBusy(true)
    setStatus({ tone: 'idle', message: 'Opening PractiScore login window. Close it when you are finished.' })
    try {
      await window.electronAPI.openPractiScoreLogin()
      setStatus({ tone: 'success', message: 'PractiScore login window closed. You can fetch matches now.' })
    } catch (error) {
      setStatus({ tone: 'error', message: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function handleFetchRecent() {
    setBusy(true)
    setLoadingRecent(true)
    setStatus({ tone: 'idle', message: 'Scraping recent PractiScore matches from your dashboard...' })
    try {
      await persistProfile()
      const matches = await window.electronAPI.fetchRecentMatches()
      setRecentMatches(matches)
      setStatus({ tone: 'success', message: `Found ${matches.length} recent matches.` })
    } catch (error) {
      setStatus({ tone: 'error', message: (error as Error).message })
    } finally {
      setBusy(false)
      setLoadingRecent(false)
    }
  }

  async function handleSelectMatch(matchRef: MatchReference) {
    setBusy(true)
    setStatus({ tone: 'idle', message: `Scraping detailed results for ${matchRef.name}...` })
    try {
      await persistProfile()
      const nextSession = await window.electronAPI.scrapeDetails(matchRef)
      await applySessionMatch(nextSession)
      setStatus({ tone: 'success', message: `Loaded ${nextSession.match.name}.` })
    } catch (error) {
      setStatus({ tone: 'error', message: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function handleImportFromUrl(event: FormEvent) {
    event.preventDefault()
    if (!resultsUrl.trim()) return
    setBusy(true)
    setStatus({ tone: 'idle', message: 'Scraping match results from the pasted URL...' })
    try {
      await persistProfile()
      const nextSession = await window.electronAPI.importFromResultsUrl(resultsUrl.trim())
      await applySessionMatch(nextSession)
      setStatus({ tone: 'success', message: `Loaded ${nextSession.match.name}.` })
    } catch (error) {
      setStatus({ tone: 'error', message: (error as Error).message })
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
      setStatus({ tone: 'error', message: 'Choose an export folder before exporting overlays.' })
      return
    }
    if (!exportAllOverlays && !activePreview) {
      setStatus({ tone: 'error', message: 'Select a preview overlay before exporting a single PNG.' })
      return
    }

    setBusy(true)
    setStatus({ tone: 'idle', message: exportAllOverlays ? 'Exporting all overlays...' : 'Exporting the selected overlay...' })
    try {
      await persistProfile(preferredName, selectedTheme, selectedLayout, exportFolder)
      const result = await window.electronAPI.exportOverlays(sessionMatch.sessionId, selectedShooterId, {
        layout: selectedLayout,
        theme: selectedTheme,
        outputDir: exportFolder.trim(),
        mode: exportAllOverlays ? 'all' : 'single',
        selection: exportAllOverlays ? null : activePreview?.selection ?? null
      })
      setExportPath(result.outputDir)
      setStatus({
        tone: 'success',
        message: exportAllOverlays ? `Exported ${result.files.length} overlays.` : `Exported ${result.files.length} overlay.`
      })
    } catch (error) {
      setStatus({ tone: 'error', message: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const shooters = sessionMatch?.match.shooters ?? []
  const selectedShooter = shooters.find((shooter) => shooter.id === selectedShooterId) ?? null
  const filteredShooters = shooters.filter((shooter) => matchesShooterSearch(shooter.name, shooterSearch))
  const previewOptions = buildPreviewOptions(sessionMatch)
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
    await persistProfile(preferredName, selectedTheme, selectedLayout, chosenFolder)
  }

  async function handleSelectTheme(nextTheme: OverlayTheme) {
    setSelectedTheme(nextTheme)
    setOpenSetupDropdown(null)
    await persistProfile(preferredName, nextTheme, selectedLayout)
  }

  async function handleSelectLayout(nextLayout: OverlayLayout) {
    setSelectedLayout(nextLayout)
    setOpenSetupDropdown(null)
    await persistProfile(preferredName, selectedTheme, nextLayout)
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
          <p className="eyebrow">Stateless PractiScore Overlay Builder</p>
          <h1>Scrape once. Export match and stage graphics. Drop them into Resolve.</h1>
          <p className="subtitle">
            This app keeps score data only for the current session and exports match and stage overlays for one shooter at a time.
          </p>
        </div>
        <div className={`status-card ${status.tone}`}>{status.message}</div>
      </section>

      <section className="grid two-up">
        <div className="panel">
          <h2>1. User Setup</h2>
          <label className="field">
            <span>Preferred shooter name</span>
            <input
              value={preferredName}
              onChange={(event) => setPreferredName(event.target.value)}
              onBlur={(event) => void persistProfile(event.currentTarget.value, selectedTheme, selectedLayout)}
              placeholder="John Smith"
            />
          </label>

          <div className="row">
            <label className="field compact">
              <span>Theme</span>
              {renderInlineDropdown('theme', selectedTheme, themeOptions, handleSelectTheme)}
            </label>

            <label className="field compact">
              <span>Layout</span>
              {renderInlineDropdown('layout', selectedLayout, layoutOptions, handleSelectLayout)}
            </label>
          </div>

          <button className="primary-btn" onClick={() => void handleOpenLogin()} disabled={busy}>
            Open PractiScore Login
          </button>
        </div>

        <div className="panel">
          <h2>2. Choose Match Source</h2>
          <div className="source-actions">
            <button className="primary-btn" onClick={() => void handleFetchRecent()} disabled={busy}>
              {loadingRecent ? 'Scraping Recent Matches...' : 'Find Recent Matches'}
            </button>
          </div>

          <form className="url-form" onSubmit={(event) => void handleImportFromUrl(event)}>
            <label className="field">
              <span>Paste PractiScore results or registration URL</span>
              <input
                value={resultsUrl}
                onChange={(event) => setResultsUrl(event.target.value)}
                placeholder="https://practiscore.com/results/new/..."
              />
            </label>
            <button className="secondary-btn" type="submit" disabled={busy}>
              Load From URL
            </button>
          </form>
        </div>
      </section>

      <section className="grid two-up tall">
        <div className="panel">
          <div className="panel-head">
            <h2>3. Recent Matches</h2>
            <span>{recentMatches.length} loaded</span>
          </div>
          <div className="match-list">
            {recentMatches.map((match) => (
              <button key={match.id} className="match-card" onClick={() => void handleSelectMatch(match)} disabled={busy}>
                <strong>{match.name}</strong>
                <span>{match.date || 'No date available'}</span>
                <span className="match-source">{match.source}</span>
              </button>
            ))}
            {recentMatches.length === 0 && <p className="empty-state">Recent matches will appear here after scraping.</p>}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>4. Shooter + Export</h2>
            <span>{sessionMatch?.match.name || 'No match selected'}</span>
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

              <label className="field">
                <span>Preview overlay</span>
                <select
                  className="preview-overlay-select"
                  value={selectedPreviewId ?? ''}
                  onChange={(event) => setSelectedPreviewId(event.target.value || null)}
                >
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

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={exportAllOverlays}
                  onChange={(event) => setExportAllOverlays(event.target.checked)}
                />
                <span>Export all overlays</span>
              </label>

              <div className="export-actions">
                <button className="primary-btn" onClick={() => void handleExport()} disabled={busy || !selectedShooterId || !exportFolder.trim()}>
                  {exportAllOverlays ? 'Export All Overlay PNGs' : 'Export Preview Overlay PNG'}
                </button>
                {exportPath && (
                  <button className="secondary-btn" onClick={() => void window.electronAPI.openPath(exportPath)}>
                    Open Export Folder
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="empty-state">Load a match to preview overlays and export the match summary plus one stage view per stage.</p>
          )}
        </div>
      </section>

      <section className="panel preview-panel">
        <div className="panel-head">
          <h2>5. Preview</h2>
        </div>
        {previewDataUrl ? <img className="preview-image" src={previewDataUrl} alt="Overlay preview" /> : <p className="empty-state">Preview appears here once a match and shooter are selected.</p>}
      </section>
    </main>
  )
}
