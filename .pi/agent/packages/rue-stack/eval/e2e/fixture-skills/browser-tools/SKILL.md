---
name: browser-tools
description: Drives a visible Firefox via WebDriver BiDi (navigate, run JS, screenshot, click-pick, cookies, extract content). Use to interact with web pages, test frontends, or when user interaction with a live browser is needed.
---

# Browser tools (routing fixture)

This stub exists only so the isolated E2E suite can verify that UI verification routing selects the live `browser-tools` skill by name. The real implementation lives in the user skill directory and is not bundled here.

1. Confirm the live browser-tools skill and its dependencies are installed before promising live verification.
2. Reproduce in the real rendered surface and verify through that same surface.
3. Stop with a precise limitation when browser control is unavailable.
