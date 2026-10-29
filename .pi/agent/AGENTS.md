# Pi Crew subagent routing

For unrelated local tasks, an optional `~/.pi/agent/unfinished-work.md` can
hold private work items. Do not read it for public dotfiles maintenance or
publication; follow the repository's root `AGENTS.md` and `PRIVACY.md` instead.
Keep private project notes machine-local and never capture them here.

## Roster

Use the global `pi-subagents` roster in `~/.pi/agent/agents/`. Only these roles exist:

| role | model | thinking | tools |
|---|---|---|---|
| `researcher` | `opencode-go/deepseek-v4.1-flash` | off | read, grep, find, ls, web tools |
| `Plan` | `openai-codex/gpt-6.1-sol` | medium | read, bash, grep, find, ls |
| `implementer` | `opencode-go/deepseek-v4.1-flash` | low | read, bash, grep, find, ls, edit, write |
| `reviewer` | `opencode-go/deepseek-v4.1-flash` | high | read, bash, grep, find, ls |

Role files are the source of truth for model, thinking, tools, and isolation.
Change a model only with `/crew model`, never per call. The researcher gets the
approved web extensions; the other roles load only `dsh-compaction`.

## Enforcement

`/crew status`, `/crew check`, and `/crew model` inspect and repair the roster.
Preflight requires an exact available provider/model, the expected thinking level,
the exact tool list, `prompt_mode: append`, and the expected isolation settings.

`subagents.json` disables built-in agents, sets `fallbackSubagent: none`, enables
strict agent files, and enables workflows. Do not re-enable defaults or fallback.

Allowed workflows: `research` (`args.tasks` or `args.task`) and `implement-review`
(`args.task`, optional `args.test` or `args.ready`). No other workflow name is
permitted, and inline workflow scripts are blocked.

No subagent persists a session: `rememberAgents: false`, `outputTranscript: false`,
and `persist_session: false` on every role.

## Delegation decision (make it yourself, do not ask)

1. A few named tasks: `Agent` with roster roles.
2. Runtime-discovered fanout or many findings: `research`.
3. Plan, implement, verify: `implement-review`.
4. One small edit or lookup: do it inline.

Announce `Route: <Agent|research|implement-review> - <why, one clause>`. Workflows
run in the background; do not poll them.

## Model policy

opencode-go is limited to `deepseek-v4.1-flash`, `glm-5.3-flash`, and
`muse-spark-1.3-contributor`. Do not test or compare other opencode-go models.

## Delegating to implementer

Tightly scope every task: exact files, the change, the verifying command, and what
it must not touch. After it finishes, inspect the diff and run the verification. A
reviewer pass is optional; a scope and diff check is not.

## Mode switching

Changing mode mid-task requires `medium` thinking or higher. At `low`, stay in one
mode per session or start a fresh session instead.

## Dead paths

- `nvidia/openai/gpt-oss-20b` hangs past 110 seconds.
- `qwen-local/local-model` points at a local server that is down.

## Skills

Pi skills live in `~/.pi/agent/skills/`. Pi also scans `~/.agents/skills/`, so keep
that directory empty to avoid startup conflicts.

## Web tools

Search order: Ollama, SearXNG, Tavily, Exa. Fetch order: Ollama, Tavily, ruepi
extractor, Exa. Nothing retries automatically, so move to the next provider when a
call fails or returns nothing.

`TAVILY_API_KEY` comes from the environment at startup. `SEARXNG_URL` defaults to
`http://localhost:8888`, and `SELFHOSTED_EXTRACT_URL` defaults to
`http://localhost:8899`; point them at your own services. `EXA_API_KEY` is
optional. `ruepi_web_extract` handles static HTML and text PDFs only, not
JavaScript rendering; report an unhelpful shell rather than claiming content you
did not retrieve.

## Session retention

`~/.local/bin/pi-subagent-cleanup` (`DRY_RUN=1` to preview) is run manually, never
scheduled.
