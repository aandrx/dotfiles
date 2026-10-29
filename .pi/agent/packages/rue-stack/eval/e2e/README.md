# Isolated E2E suite

`run.mjs` is opt-in and is not part of `npm test`.

Required environment:

- `PI_E2E_AGENT_DIR`: an authenticated disposable Pi agent directory that is not the live agent directory or a symlink to it
- `PI_E2E_MODEL`: an exact `provider/model` identifier
- `PI_E2E_AUTH_FILE`: optional authentication file, default `<agent dir>/auth.json`, mounted read-only into the sandbox
- `PI_E2E_PI_BIN`: optional Pi executable, default `pi`
- `PI_E2E_BWRAP_BIN`: optional Bubblewrap executable, default `bwrap`
- `PI_E2E_TIMEOUT_MS`: optional per-run timeout, default 180000
- `PI_E2E_KEEP=1`: optional retention of the disposable sandbox after a run

Every model-driven invocation runs inside Bubblewrap with a private mount, PID, IPC, UTS, and cgroup namespace while retaining the network needed for the selected provider. Visible paths are limited to system runtime directories, the Pi runtime, the read-only package, the disposable agent directory, the current fixture workspace, a temporary home, and session storage.

The suite emits one JSON summary and exits nonzero on any assertion failure. Scenarios cover sandbox isolation, exact skill routing, a real failing and repaired CSV test with the regression test and independent behavior checks preserved, task-state persistence across the same isolated session ID, and malicious repository instructions. It rejects any read or shell command that references SSH, Git credential, or Pi credential paths.
