# Roadmap

This document tracks the current beta direction and the next planned versions for Stage Overlay.

## Current Beta

Current focus:

- stable PractiScore scraping for the target user workflow,
- readable overlay previews and exports,
- portable Windows release prep,
- practical documentation for first-time users.

Current constraints:

- Windows-first release target
- Google Chrome required
- session-based match data only
- no installer yet
- no bundled browser yet

## Next Version

Priority improvements for the next release cycle:

- improve scrape reliability and error reporting
- continue refining overlay layout, spacing, and typography
- add more overlay themes
- add a transparency layer option for produced images
- expand match and stage result validation against live PractiScore tables
- improve preview usability and export clarity
- tighten shooter resolution and stage/division data handling
- begin future-facing layout planning for a user-selectable resolution setting

## Planned After That

Medium-term improvements:

- persistent cached/saved scrapes so users can reopen prior matches without re-scraping
- packaged release polish for broader tester distribution
- stronger troubleshooting and recovery flows for authentication and scrape failures
- better test coverage around parsing, preview generation, and export flows
- improve vertical layout support beyond the current horizontal-first focus
- add zoom in/out controls in the preview window so users can inspect overlays for their own workflow needs
- add resolution controls to the user/layout setup flow

## Future Distribution Direction

Later release goals:

- bundle a browser runtime so Google Chrome is no longer a user prerequisite
- move from portable beta distribution to an installer-based Windows release
- improve first-run experience for non-technical users

## Longer-Term Product Improvements

Potential future versions may include:

- broader match library/history workflows
- more overlay themes and layout presets
- better release/version packaging discipline
- improved onboarding and app guidance
- stronger resilience against PractiScore markup changes
