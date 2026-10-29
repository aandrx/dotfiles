# rue-stack

Installed Pi package providing three working modes, a shared policy layer, and 27 skills.

## Layout

- `extensions/global-policy.ts` injects the short cross-cutting policy.
- `extensions/mode.ts` implements `/shipp`, `/momentum`, `/quality`, `/mode status|off`, and `/quality fix`, persisted per session branch.
- `extensions/task-state.ts` stores an ordered checklist in immutable tool-result details.
- `skills/` holds 27 skills: 5 shared, 15 shipp-side, 6 momentum-side, plus `quality`.
- `mcp/` holds the de-branded Supabase, Neon, and Stripe MCP bundles.
- `VENDOR.json` records upstream commits, upstream-transformed hashes, current hashes, and every locally patched file with its reason.
- `LICENSES/` carries upstream MIT licenses; `skills/agentation/LICENSE` carries PolyForm Shield.

## Modes

- `/shipp` playbooks, reproduction, regression tests, same-surface verification, 15-call budget
- `/momentum` interview to spec in `.plans/`, thin vertical slice, UI polish, Codex for backend
- `/quality` review-only with an E2E matrix; `/quality fix` additionally authorizes repairing named findings and re-running affected rows
- `/mode off` plain Pi plus policy

Mode switching mid-task needs `medium` thinking or higher.

## Verification

`npm test` runs deterministic checks: task-state transitions, policy and mode injection, skill frontmatter and catalog budget, recursive vendor hashes, declared patches, licenses, and a branding scan.

`npm run e2e` runs the sandboxed model suite. It needs `PI_E2E_AGENT_DIR` and `PI_E2E_MODEL`, refuses the live agent directory, and runs each case inside Bubblewrap with host home, SSH, and credentials unmounted.

Evidence and the manual test script live under `eval/`.
