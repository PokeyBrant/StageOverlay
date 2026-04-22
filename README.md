# Stage Overlay

Portable Windows app for importing match data, previewing shooter overlays, and exporting PNG graphics for video workflows.

## What It Does

- Imports a saved match page file into the current session.
- Resolves the preferred shooter for the loaded match.
- Previews match and stage overlays before export.
- Exports one overlay or the full set of PNGs to a folder you choose.
- Saves style, background, and canvas-size preferences locally.

## Current Public Build

This public build is focused on the overlay shell itself:

- local match-file import
- shooter selection
- style customization
- PNG preview and export

## Requirements

- Windows
- Node.js and npm for local source usage

## Local Source Usage

```powershell
npm install
npm run dev
```

## Typical Workflow

1. Set the preferred shooter name.
2. Import one saved match page file.
3. Confirm the selected shooter.
4. Adjust theme, background, and canvas size.
5. Choose an export folder.
6. Export PNG overlays.

## Customization Features

- ten built-in themes
- procedural background seed with one saved favorite slot
- optional uploaded static background image
- explicit canvas width and height controls
- preset sizing plus aspect-lock support

## Maintainer Commands

```powershell
npm run test
npm run package:portable
```

Portable and directory builds are written under `release/`.

## Troubleshooting

### The wrong shooter was selected

Use the searchable shooter control in section `4` and pick the correct shooter manually.

### The exported PNG size is wrong

Check the selected width, height, aspect-lock state, and preview selection before exporting again.

## Known Limitations

- Windows-first beta target
- Session-based match data rather than a persistent library
- Ongoing layout and typography refinement

Planned future work lives in [ROADMAP.md](./ROADMAP.md).
