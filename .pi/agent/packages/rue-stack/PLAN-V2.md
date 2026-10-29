# Rue stack plan v2

Supersedes the earlier shadow plan. Nothing in this document is applied yet.

## Locked decisions

| # | Decision |
|---|---|
| 1 | Strip user-facing branding from both sides. Keep legal attribution: LICENSE files, THIRD_PARTY_NOTICES, upstream commit pins. MIT and PolyForm Shield both require notices to survive. |
| 2 | Momentum side ships all six upstream skills with behavior unmodified. Only namespacing and role framing change. It runs as its own trusted workflow, not reinterpreted through shipp rules. |
| 3 | Codex skill is for backend delegation. The session agent plans and does frontend; Codex implements backend. Default Codex mode stays read-only review unless implementation is authorized. |
| 4 | Where writing standards overlap, jmo wins. `ste` is the single writing authority. Drop pstack `technical-writing`, `unslop`, `teach`. Keep `tdd`, which has no jmo equivalent. |
| 5 | Remove the OpenCode bridge completely, including the il-pi startup patch and the running `opencode serve` process. |
| 6 | Bookmark a later deep dive on pstack `swarm`, `arena`, `interrogate`, `orchestrate` versus Pi Crew. Do not adopt or remove them now. |

## Inventory

### Momentum pack, 6 skills

`interview`, `ste`, `better-ui`, `animate`, `agentation`, `codex`.

MCP bundles kept, renamed without personal namespace: `mcp-supabase`, `mcp-neon`, `mcp-stripe`. Server URLs unchanged. Authentication stays per user.

### Shipp pack, 12 skills plus 4 playbooks

Skills: `rue-mode` (router), `how`, `blast-radius`, `sharpen`, `create-verification-skill`, `maintain-verification-skill`, `correct`, `benchmark-checklist`, `no-comments`, `show-me-your-work`, `recall`, `tdd`, `typescript-best-practices`.

Playbooks inside the router: investigation, bug-fix, feature, refactor.

Not adopted: `poteto-help`, `setup-pstack`, both formal-verification skills, `make-bot-ui`, `automate-me`, `reflect`, `teach`, `technical-writing`, `unslop`, `why`, `arena`, `swarm`, `interrogate`, `figure-it-out`, `architect`, `bro`, `in-your-own-words`, `ketchup`.

### Shared, available in both modes

`git-ops`, `web-research`, `machine-maintenance`, `pi-operations`, `browser-tools`, `dotfiles-sync`, `frontend-design`, `ste`.

### De-branding map

| Upstream | Here |
|---|---|
| `poteto-mode` | `rue-mode` |
| `comment-sicko` agent | `comment-reviewer` |
| `poteto-agent` | not adopted |
| `jmo-workflow` plugin | momentum pack |
| `jmo-supabase`, `jmo-neon`, `jmo-stripe` | `mcp-supabase`, `mcp-neon`, `mcp-stripe` |
| "poteto" style language | neutral voice rules |

## Modes

Commands: `/shipp`, `/momentum`, `/mode status`, `/mode off`. Default is `off`.

State persists as a session custom entry and is reconstructed from the active branch. The active contract is injected every turn through a stable system-prompt section key, replacing rather than appending.

Shipp contract: pick one playbook, reproduce or establish current behavior, keep a task list with skip reasons, require regression coverage where practical, run blast-radius on non-trivial diffs, verify on the same surface, ship with ordered commits and an evidence-bearing description.

Momentum contract: when requirements are vague, run `interview` and write `.plans/<slug>-spec.md`; build the thinnest runnable vertical slice; polish the visible surface with `better-ui` and `animate`; delegate backend implementation to Codex; verify the demo path actually runs. Follow the upstream skills as written.

Shared in both: never claim unverified success, preserve unrelated changes, no secrets or credential edits, label observed versus inferred, stop and report exact blockers.

## OpenCode removal

Files that reference it:

- `~/.pi/agent/extensions/opencode-bridge.ts`
- `~/.pi/agent/extensions/tests/opencode-bridge.test.ts`
- `~/.pi/agent/AGENTS.md` (OpenCode section)
- `~/.pi/agent/extensions/exa-search.ts` (reference needs inspection before edit)
- `~/.pi/bin/pi-startup.mjs` (il-pi model registration and notify patch)
- `~/dotfiles/dot_zshrc.tmpl` (`oc` and `il` aliases, PATH entry)
- `~/.pi/agent/auth.json` (provider credentials)
- `~/.pi/agent/models-store.json` (catalog text, leave, regenerated)

Order:

1. Stop `opencode serve`, confirm no autostart unit exists.
2. Remove the bridge extension and its test.
3. Remove the il-pi startup patch and its invocation.
4. Remove the OpenCode section from `AGENTS.md`.
5. Remove shell aliases and PATH entry, through chezmoi.
6. Remove unused OpenCode credentials, after a backup.
7. Verify: no `opencode` models listed, no process, Pi Crew check passes, no dangling references.

Impact is low. Session history shows `cline-free/*` usage, not `opencode-free/*`, and all four agent roles pin `openai-codex/gpt-6-luna`.

Rollback is restoring the deleted files from dotfiles Git history plus `git restore` of the zsh template.

## Phases

Status as of 2026-10-19: phases 1 to 7 complete inside the shadow package.

1. DONE. Vendored 46 files from pstack `ddf824a` and jmo `6082bf2`, de-branded, licenses kept, hashes recorded in `VENDOR.json` with the seven intentional Pi patches declared.
2. DONE. All six momentum skills present with upstream behavior, plus the three de-branded MCP bundles.
3. DONE. Shipp pack includes the four playbooks, the 15 selected skills, and the restored `technical-writing`, `unslop`, `teach`, `tdd`.
4. DONE. OpenCode bridge, test, il/opencode startup patch, wrapper, `~/.opencode`, npm dependency, lockfile entries, auth provider entry, and AGENTS section removed. `opencode-go` kept and verified. System package `opencode 1.18.25-1` needs `sudo pacman -Rns opencode`.
5. DONE. `/shipp`, `/momentum`, `/mode status|off`, branch-persisted state, stable section injection, and `RUE_STACK_MODE` bootstrap for scripted runs.
6. DONE. 26 skills validated, 46 vendored files hash-verified, patched set pinned, brand scan clean, policy and mode injection tested.
7. DONE. Full green sandboxed E2E on `opencode-go/gpt-6-luna` at low thinking: all six scenarios. `deepseek-v4.1-flash` at low is flaky on the shipp skill-read step.

## Open questions

- Does removing OpenCode also mean removing the `il` CLI and its aliases, or only the Pi bridge?
- Should Codex default to backend implementation in momentum, or stay read-only review unless explicitly asked to implement?
- Where should the bookmark for the swarm/arena/interrogate/orchestrate deep dive live?
