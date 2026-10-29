# rue-stack

rue-stack is the working setup for a single Pi coding agent run as an engineering team. It is the same idea as pstack: skills that encode a method, three modes that pick the right method for the task, and subagents that get tightly scoped work. It is built for Pi, not Cursor, so the harness specifics differ while the intent does not.

The goal is not more output. It is code you can defend: reproduced bugs, regression tests, same-surface verification, and review that finds real defects instead of style noise.

**Modes are the entry point.** `/shipp` for rigorous development, `/momentum` for shaping and shipping a product, `/quality` for review-first audits, `/quality fix` to repair named findings, `/mode off` to return to plain work. Every skill stays available in every mode; the mode decides which ones the agent reaches for.

**Subagents are for scoping, not volume.** Pi Crew runs `researcher`, `Plan`, `implementer` and `reviewer` on pinned models with pinned thinking levels. A delegation is a contract: exact files, the change, the verifying command, and what not to touch.

## install

This package is a reference stack, not a cloneable machine. Take what fits your setup.

**Use the skills directly.** Copy the skill directory you want into your agent's skills folder, for example `~/.pi/agent/skills/<name>/`, and read its `SKILL.md`. Skills are portable; the mode extension and the roster are not.

**Use the whole package.** Copy `packages/rue-stack` into your agent directory, then reference it from `~/.pi/agent/settings.json` under `packages` as `./packages/rue-stack`. Confirm it loads:

```bash
pi list          # rue-stack should appear
/crew check      # roster, models, thinking levels, tools
```

**Read it as a worked example.** The modes, the policy injection, the enforced roster and the vendoring manifest are all documented here so you can build your own version rather than adopt this one. Model names, thinking levels and agent roles are specific to this setup and will not be right for yours.

The private companion repo holds machine-specific and non-public pieces; it is not published and not required to use anything here.

## get started

1. Read `AGENTS.md` at the repo root of your agent dir. It is the roster and delegation contract, not a suggestion.
2. Start a task with a mode: `/shipp`, `/momentum`, or `/quality`.
3. When you delegate, scope the task. `implement-review` runs plan, implement, verify, then a parallel correctness and regression review.

If you are unsure which mode fits, the answer is usually `/shipp`. It is the one with playbooks and a verification habit.

## usage

Pick the mode before typing the task, not after. Switching modes mid-task needs `medium` thinking or higher, because at `low` the agent tends to keep reasoning in the old mode while claiming the new one.

```text
/shipp this endpoint returns 500 on empty body. repro first, fix, then re-run the failing request.
/momentum interview me on this feature, write the spec, then build the first vertical slice.
/quality audit the auth flow end to end and report findings by severity.
/quality fix fix findings H1 and H3, then re-run the rows they touch.
```

`/mode off` clears the mode contract without clearing the skills.

## skills

Twenty-nine skills, grouped by what they are for.

- **Modes.** `rue-mode` for shipp discipline, `quality` for review-first audits, plus the momentum flow built on `interview` and `codex`.
- **Verification.** `blast-radius` proves what a change can break, `benchmark-checklist` forces a measured before and after, `create-verification-skill` and `maintain-verification-skill` make a repo testable when it is not.
- **Implementation.** `how`, `sharpen`, `correct`, `tdd`, `typescript-best-practices`, `no-comments`, `show-me-your-work`, `recall`.
- **Interface.** `better-ui`, `animate`, `motion-design`, `dimensional-drawing`.
- **Writing.** `ste`, `technical-writing`, `unslop`, `teach`.
- **Operations.** `git-ops`, `machine-maintenance`, `pi-operations`, `web-research`, `agentation`.

Each skill is a `SKILL.md` with frontmatter. Explicit-only skills set `disable-model-invocation: true`, so they never fire by accident; the mode contract names them when needed.

### examples

```text
/skill:git-ops commit the vendoring and push to origin
/skill:dimensional-drawing make a spec sheet for this dialog component
/skill:benchmark-checklist prove the query got faster without changing results
```

## the subagents

Pi Crew enforces the roster: exact provider and model, exact thinking level, exact tool list, appended prompt. The defaults are disabled and there is no fallback, so an unavailable model fails loudly instead of silently downgrading.

| Role | Model | Thinking | Job |
|---|---|---|---|
| `researcher` | deepseek-v4.1-flash | off | verifiable research, primary sources, no writing |
| `Plan` | gpt-6.1-sol | medium | evidence-based plan, read-only |
| `implementer` | deepseek-v4.1-flash | low | one scoped change, verified |
| `reviewer` | deepseek-v4.1-flash | high | independent defect review, read-only |

Two workflows are allowed: `research` for runtime-discovered fan-out, and `implement-review` for staged changes. The second gates verification on the repo's own test command, then reviews correctness and regression in parallel, each reading the real diff.

## principles

- Reproduce before fixing. A bug you cannot trigger is a bug you cannot verify.
- Verify on the same surface the user touches, not on a mock of it.
- Measure performance changes. Name the limiter; do not claim a win you did not observe.
- Review for defects, in a capped list, labelled Important, Nit, or Pre-existing, with `git blame` proof for the last one.
- Keep the prompt prefix stable. Policy and mode sit at fixed positions so caching keeps working.
- Trust but verify. An implementer's summary is intent, not outcome; read the diff.
- Stop rather than fabricate. An unreachable source or an unrun test is a finding.

## not shipped here

- Secrets, machine-specific config, and private account material, which live in the private companion repo.
- Third-party skill bodies are vendored under `skills/` with `VENDOR.json` pinning the upstream commit and hashing every file, plus `LICENSES/` for attribution. Vendored bodies are never edited in place without declaring the patch in the manifest.
- Large media assets from upstream projects are not vendored.

## why are there no planning skills?

Planning is a subagent, not a skill. `Plan` runs read-only on a strong model, returns a scoped plan, and the implementer executes it. A planning skill in the main context would compete for the same attention as the work itself, and the plan would drift as the context filled.

## make it yours

Fork it. Change the roster with `/crew model`, not per call. Add a skill by creating `skills/<name>/SKILL.md`, then run `node eval/check.mjs` to confirm the catalog budget, the vendor manifest, and the brand checks still pass.

Locked decisions worth respecting: user-facing names are de-branded, licenses and attribution are kept, and the package does not bundle live browser or dotfiles tooling.

## automations

Nothing runs on a schedule. The subagent session cleanup script is manual by design, and the deterministic suite is run when the stack changes rather than on a timer. Cost is driven by tool calls, so the budget belongs in the task, not in a cron.

## license

MIT for this package's own material. Vendored skills keep their upstream licenses, recorded in `LICENSES/` and pinned in `VENDOR.json`.
