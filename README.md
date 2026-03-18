# Stage Overlay

Portable Windows beta for scraping PractiScore results and exporting match and stage overlay PNGs for use in video workflows such as DaVinci Resolve.

This app was primarily created for hit-factor style practical shooting matches such as USPSA.

## What It Does

- Opens a PractiScore login window using your local browser profile.
- Loads recent matches from your PractiScore dashboard or from a pasted results URL.
- Resolves a preferred shooter for the current match.
- Previews overlay graphics inside the app.
- Exports match and stage PNG overlays to a folder you choose.

## Current Beta Status

This project is currently a Windows-focused beta build.

It is intended for:

- creators building shooter cards or score overlays,
- users comfortable signing into PractiScore,
- testers who can tolerate occasional scraping/layout bugs while the workflow is still being refined.

## Requirements

Before running the app, make sure you have:

- Windows
- Google Chrome installed
- access to the PractiScore account you want to scrape from

Why Chrome is required right now:

- the scraper launches Playwright against your local Chrome installation,
- this is the most reliable way the current app can authenticate and reach PractiScore results,
- a bundled browser is planned for a later version but is not part of this beta release.

## Getting The App

This repo is being prepared to ship a portable Windows executable.

For a packaged beta build:

1. Download the portable release artifact from the project release location.
2. Extract it to a folder you can keep on your machine.
3. Run the packaged `Stage Overlay` executable.

For local source usage:

1. Install Node.js and npm.
2. Install dependencies:

```powershell
npm install
```

3. Run the app:

```powershell
npm run dev
```

## First Run Setup

1. Launch the app.
2. In `1. User Setup`, enter your preferred shooter name.
3. Choose your preferred theme and layout.
4. Click `Open PractiScore Login`.
5. Sign in to PractiScore in the opened browser window.
6. Close that browser window when login is complete.

Your preferences are saved locally for later sessions.

## How To Use It

### Load A Match

You can load a match in either of these ways:

- Click `Find Recent Matches` to scrape the recent-events list from your PractiScore dashboard.
- Paste a PractiScore results URL or registration/results page URL into the manual load field.

### Pick The Shooter

After a match loads:

1. The app attempts to resolve your preferred shooter automatically.
2. In `4. Shooter + Export`, confirm the focus shooter.
3. If needed, search and select the correct shooter manually.

The app also shows the detected division for the selected shooter.

### Preview An Overlay

1. Use `Preview overlay` to choose either:
   - `Match Summary`
   - a stage-specific overlay
2. Review the generated image in `5. Preview`.

### Export PNGs

1. Choose an export folder.
2. Leave `Export all overlays` checked to export the whole set.
3. Uncheck it to export only the currently previewed overlay.
4. Click the export button.

The app writes PNGs directly into the selected export folder.

## Typical Workflow

1. Open login
2. Authenticate with PractiScore
3. Load a recent match or paste a results URL
4. Confirm the shooter
5. Choose the overlay preview
6. Choose an export folder
7. Export PNGs
8. Bring the PNGs into your editing workflow

## Portable Build Commands

For maintainers preparing Windows beta builds from source:

```powershell
npm run test
npm run package:portable
```

Output is written to:

```text
release/
```

There is also a directory packaging target for inspection:

```powershell
npm run package:dir
```

## Troubleshooting

### The login or scrape flow fails

Check:

- Chrome is installed
- you are still logged in to PractiScore
- PractiScore is reachable from your network

If login expires, open the PractiScore login window again and sign back in.

### Recent matches do not load

Check:

- your PractiScore dashboard is accessible after login,
- the session window was closed only after login completed,
- PractiScore is not blocking the session with extra verification.

### A match loads but the wrong shooter is selected

Use the searchable shooter control in `4. Shooter + Export` and pick the correct shooter manually.

### Export works but the images are wrong

Check:

- the correct shooter is selected,
- the correct preview overlay is selected,
- the detected division is correct,
- the chosen export folder is writable.

## Known Limitations

- Windows-only beta target for packaged release prep
- Google Chrome is required
- Scraped data is session-based rather than a persistent match library
- PractiScore page/layout changes may require scraper updates
- Overlay layout and typography are still being refined
- Horizontal layout is the current primary focus; vertical layout is planned for further improvement in a future version

## Future Improvements

Planned future work lives in [ROADMAP.md](./ROADMAP.md).

Near-term and future goals include:

- additional overlay themes
- a transparency layer option for produced images
- continued work on vertical layout quality
- preview zoom controls for better per-user inspection
- future resolution controls as part of user/layout setup
- a later move toward a bundled browser and installer-based distribution
