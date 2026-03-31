# Changelog

## v0.1.2 Beta 1 - 2026-03-31

- Fixed PractiScore stage scraping so hidden/native dropdown controls can still be discovered and driven, which restores stage results instead of returning only the match summary.
- Added a safer fallback so the scraper ignores dropdown-driven results when no stage scopes were found and falls back to the page parser instead of returning an empty stage list.
- Hardened build packaging by cleaning stale output folders before builds, verifying packaged artifacts, and shipping the app as `app.asar` instead of a loose unpacked app tree.

## v0.1.1 Beta 1 - 2026-03-27

- Fixed packaged app startup by keeping the hardware acceleration workaround, but only applying it before Electron is ready.
- Changed exported stage overlay filenames from internal UUID-style names to readable stage numbers like `Stage 1.png`.
- Kept the stage subtitle inside the PNG readable and unchanged.
