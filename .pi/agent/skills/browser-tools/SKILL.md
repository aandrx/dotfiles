---
name: browser-tools
description: Drives a visible Firefox via WebDriver BiDi (navigate, run JS, screenshot, click-pick, cookies, extract content). Use to interact with web pages, test frontends, or when user interaction with a live browser is needed.
---

# Browser Tools

Automates a dedicated, isolated Firefox instance over WebDriver BiDi. It never touches the user's normal Firefox (own profile, own port). Setup and each operation are subcommands of one script.

## Setup (once)

`{skillDir}/browser.js` needs npm deps. Run from the skill directory:

```bash
cd {skillDir} && npm install
```

`{skillDir}` is the directory containing this SKILL.md. `node {skillDir}/browser.js` can be shortened to `node <skillDir>/browser.js` below.

## Start / Stop

```bash
node <skillDir>/browser.js start           # launch or attach the dedicated browser
node <skillDir>/browser.js start --headless
node <skillDir>/browser.js stop            # stops only the dedicated instance
node <skillDir>/browser.js status          # current url / title
```

All non-start commands auto-start if needed, so only `start` up-front is required. Use an isolated profile + port 9222 (env `PI_BROWSER_PORT` / `PI_BROWSER` to override). Always `stop` the dedicated instance when you are done (don't leave it running).

## Local dev server (npm run dev)
If you need to exercise a local app in the browser, run the dev server in a **separate terminal / process** (e.g. `npm run dev -p 3001`); keep the browser running in its own terminal. When finished, clean up BOTH:
- `node browser.js stop` (the dedicated Firefox)
- stop the dev server too (Ctrl+C / kill the `next`/`npm run dev` process) so you don't leave it running. Opera:
- `nav <url> [--new] [--reload]` - navigate; `--new` opens a tab.
- `viewport <width> <height>` - resize the active tab's viewport (use for narrow/mobile testing, e.g. `viewport 720 900`).
- `eval '<js>'` - run JS in the active tab (async context). Prefers a single expression (returns its value); falls back to running the text as statement(s), so multi-line/`;`-separated code works. Extracts state, inspects DOM, clicks.
- `screenshot [--path F]` - viewport image; returns a file path.
- `cookies` - session/auth cookies for the active tab.
- `content <url>` - extract readable article text as markdown.
- `pick '<instruction>'` - interactive: user clicks elements (Ctrl/Cmd+click multi, Enter done), returns element info/selectors. Use when the user must choose specific DOM elements or the structure is ambiguous.

Prefer DOM inspection over screenshots to save tokens: `document.body.innerText.slice(0,4000)` or map interactive elements. Batch interactions; wrap multi-statement work in one async IIFE. If the DOM updates after an action, `sleep 0.5` then `eval`. Before acting, inspect page structure first (forms, buttons, inputs, and `innerHTML` slice), then target what you found.