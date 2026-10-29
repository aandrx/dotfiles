# Integration status

Installed and verified 2026-10-20. This replaces the earlier pre-install plan.

## Live state

- Package: `~/.pi/agent/packages/rue-stack`, listed as `./packages/rue-stack` in `settings.json`
- Modes: `/shipp`, `/momentum`, `/quality`, `/quality fix`, `/mode off`
- Policy injected through `before_agent_start`; mode state persisted per session branch
- `AGENTS.md` trimmed to 3,505 bytes: roster table, enforcement, delegation decision, model policy, implementer discipline, mode-switch rule, web tools, dead paths, retention
- `APPEND_SYSTEM.md` reduced to 1,070 bytes: web provider order, secret paths, dotfiles pointer, machine plan
- Default model: `opencode-go/deepseek-v4.1-flash` at `low`
- Roster: researcher and implementer deepseek, Plan `gpt-6.1-sol` at medium, reviewer deepseek at high
- Startup accepted at roughly 1.3 s; no further optimisation planned

## Verification performed

- `/crew check` passes; both workflows report ready
- Deterministic suite green, including 46 vendored-file hashes
- Sandboxed E2E green on deepseek low and high, and on muse low
- Real work: spotifi bug fix, investigation, feature, quality audit, and `/quality fix` repair, each verified independently
- Malicious-repository refusal verified in sandbox and live

## Rollback

Remove `./packages/rue-stack` from `settings.json`, delete the package directory, restore `AGENTS.md` and `APPEND_SYSTEM.md` from the backups in `/tmp` or from chezmoi once captured.

## Known gaps

- Dotfiles capture deferred; live config drifts from chezmoi
- Startup: `pi-subagents` eagerly imports its workflow and UI graph, roughly 450 ms; accepted, not patched
- Mode switching at `low` thinking misreports the active mode; use `medium`
