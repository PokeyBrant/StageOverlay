import { startTransition, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { MatchReference, OverlayLayout, OverlayTheme, SessionMatch, UserProfile } from '../electron/types'

type Status = {
  tone: 'idle' | 'success' | 'error'
  message: string
}

const defaultStatus: Status = { tone: 'idle', message: 'Authenticate, pick a source, and export stage overlays.' }

export default function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [preferredName, setPreferredName] = useState('')
  const [resultsUrl, setResultsUrl] = useState('')
  const [recentMatches, setRecentMatches] = useState<MatchReference[]>([])
  const [loadingRecent, setLoadingRecent] = useState(false)
  const [sessionMatch, setSessionMatch] = useState<SessionMatch | null>(null)
  const [selectedShooterId, setSelectedShooterId] = useState<string | null>(null)
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null)
  const [selectedTheme, setSelectedTheme] = useState<OverlayTheme>('carbon')
  const [selectedLayout, setSelectedLayout] = useState<OverlayLayout>('horizontal')
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null)
  const [exportPath, setExportPath] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>(defaultStatus)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.electronAPI.getUserProfile().then((value) => {
      setProfile(value)
      setPreferredName(value.preferredShooterName)
      setSelectedTheme(value.preferredTheme)
      setSelectedLayout(value.preferredLayout)
    })
  }, [])

  useEffect(() => {
    if (!sessionMatch || !selectedShooterId) return
    const stageId = selectedStageId ?? sessionMatch.match.stages[0]?.id
    if (!stageId) return

    startTransition(() => {
      void window.electronAPI
        .previewOverlay(sessionMatch.sessionId, selectedShooterId, stageId, selectedLayout, selectedTheme)
        .then((preview) => {
          setSelectedStageId(preview.stageId)
          setPreviewDataUrl(preview.imageDataUrl)
        })
        .catch((error: Error) => {
          setStatus({ tone: 'error', message: error.message })
        })
    })
  }, [sessionMatch, selectedShooterId, selectedStageId, selectedLayout, selectedTheme])

  async function persistProfile(nextName = preferredName, nextTheme = selectedTheme, nextLayout = selectedLayout) {
    const saved = await window.electronAPI.saveUserProfile({
      preferredShooterName: nextName,
      preferredTheme: nextTheme,
      preferredLayout: nextLayout
    })
    setProfile(saved)
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
    const resolvedId = resolution.shooterId ?? resolution.candidates[0]?.id ?? null
    setSelectedShooterId(resolvedId)
    setSelectedStageId(nextSession.match.stages[0]?.id ?? null)
  }

  async function handleExport() {
    if (!sessionMatch || !selectedShooterId) return
    setBusy(true)
    setStatus({ tone: 'idle', message: 'Exporting stage overlays...' })
    try {
      await persistProfile()
      const result = await window.electronAPI.exportOverlays(sessionMatch.sessionId, selectedShooterId, {
        layout: selectedLayout,
        theme: selectedTheme
      })
      setExportPath(result.outputDir)
      setStatus({ tone: 'success', message: `Exported ${result.files.length} stage overlays.` })
    } catch (error) {
      setStatus({ tone: 'error', message: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const shooters = sessionMatch?.match.shooters ?? []
  const stages = sessionMatch?.match.stages ?? []

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Stateless PractiScore Overlay Builder</p>
          <h1>Scrape once. Export stage graphics. Drop them into Resolve.</h1>
          <p className="subtitle">
            This app keeps score data only for the current session and exports one stage image per shooter-focused overlay.
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
              <select
                value={selectedTheme}
                onChange={(event) => {
                  const next = event.target.value as OverlayTheme
                  setSelectedTheme(next)
                  void persistProfile(preferredName, next, selectedLayout)
                }}
              >
                <option value="carbon">Carbon</option>
                <option value="sunset">Sunset</option>
              </select>
            </label>

            <label className="field compact">
              <span>Layout</span>
              <select
                value={selectedLayout}
                onChange={(event) => {
                  const next = event.target.value as OverlayLayout
                  setSelectedLayout(next)
                  void persistProfile(preferredName, selectedTheme, next)
                }}
              >
                <option value="horizontal">Horizontal</option>
                <option value="vertical">Vertical</option>
              </select>
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
                <select value={selectedShooterId ?? ''} onChange={(event) => setSelectedShooterId(event.target.value || null)}>
                  {shooters.map((shooter) => (
                    <option key={shooter.id} value={shooter.id}>
                      {shooter.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Preview stage</span>
                <select value={selectedStageId ?? ''} onChange={(event) => setSelectedStageId(event.target.value || null)}>
                  {stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.order}. {stage.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="export-actions">
                <button className="primary-btn" onClick={() => void handleExport()} disabled={busy || !selectedShooterId}>
                  Export All Stage PNGs
                </button>
                {exportPath && (
                  <button className="secondary-btn" onClick={() => void window.electronAPI.openPath(exportPath)}>
                    Open Export Folder
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="empty-state">Load a match to preview overlays and export stages.</p>
          )}
        </div>
      </section>

      <section className="panel preview-panel">
        <div className="panel-head">
          <h2>5. Preview</h2>
          <span>{profile ? `Default shooter: ${profile.preferredShooterName || 'Not set'}` : 'Loading preferences...'}</span>
        </div>
        {previewDataUrl ? <img className="preview-image" src={previewDataUrl} alt="Overlay preview" /> : <p className="empty-state">Preview appears here once a match and shooter are selected.</p>}
      </section>
    </main>
  )
}
