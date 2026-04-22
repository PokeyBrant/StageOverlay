# Changelog

## v0.1.2 Beta 1 - 2026-03-31

- Improved stage-result parsing so imported match data preserves stage breakdowns more reliably.
- Hardened build packaging by cleaning stale output folders before builds and verifying packaged artifacts.
- Continued refining the overlay shell for public preview and export workflows.

## v0.1.1 Beta 1 - 2026-03-27

- Fixed packaged app startup by keeping the hardware acceleration workaround, but only applying it before Electron is ready.
- Changed exported stage overlay filenames from internal UUID-style names to readable stage numbers like `Stage 1.png`.
- Kept the stage subtitle inside the PNG readable and unchanged.
