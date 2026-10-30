# Plain dotfiles and a customized Pi setup

Ordinary folders and real filenames, with no chezmoi, templating engine, or
hidden capture daemon. Read [AGENTS.md](AGENTS.md) before making changes and
[PRIVACY.md](PRIVACY.md) before adding anything to Git.

**Public distribution:** this repository starts from a clean snapshot, not a
clone of the maintainer's private history. Private history must never be merged
or pushed here; see `PRIVACY.md`. Original work is MIT-licensed under
[LICENSE](LICENSE); third-party licenses remain component-specific. See
[NOTICE.md](NOTICE.md).

## Layout

| Repository path | Meaning |
| --- | --- |
| `.config/` | Portable application settings; Linux desktop files are OS-gated. |
| `.pi/agent/` | Pi instructions, roles, extensions, skills, workflows and packages. |
| `.pi/bin/`, `bin/`, root shell files | Home-directory configuration and utilities. |
| `*.example` | Non-deployed examples that require local review/customization. |
| `scripts/`, `.github/`, `.githooks/`, root docs | Repository-only maintenance and checks. |

The home layout mirrors `~`; it does **not** mean that everything in `~` belongs
in Git. Installers consume the tracked manifest, not every file physically in
the checkout. Ignored local notes and dependencies are not distributable input.

## Pi customization

The repository preserves the local setup, rather than silently reinstalling
upstream versions of patched packages:

- `AGENTS.md`, `APPEND_SYSTEM.md`, `agents/`, and `subagents.json`: policy and
  the `researcher`, `Plan`, `implementer`, `reviewer` roster.
- `extensions/`, `skills/`, `workflows/`: maintained sources and tests.
- `packages/rue-stack/`: skills, modes, task-state and global-policy extensions.
- `packages/pi-subagents/`: maintained subagent/workflow runtime.
- `packages/pi-context-bar/`: customized footer with mode/task progress,
  session name, cache metrics, throughput and cost layout.
- `packages/pi-split-view/`: local widget behavior.

Keep the `./packages/...` references in `settings.json`. Replacing those with
npm sources loses local changes. Package-local `LOCAL-CHANGES.md`, licenses,
and `rue-stack/VENDOR.json` document provenance. Other npm sources in settings
are installed separately; their upstream updates can change behavior.

Private provider configuration, model credentials, sessions, personal notes,
and the installed Pi runtime are deliberately not included. Clone recipients
must install Pi and authenticate themselves. The separately licensed local
`frontend-design` skill is also excluded pending redistribution permission.

## Install on another machine

Review the source first. Maintenance scripts require Git, Python 3.10+, Bash
4+, and GNU coreutils (`realpath`, `stat`, `sort`). They are tested on Linux;
macOS needs compatible tools on PATH, and system configuration is Linux-only.
Clone the public distribution, not the separate private-history repository:

```sh
git clone https://github.com/aandrx/dotfiles.git ~/dotfiles
cd ~/dotfiles
./scripts/install.sh --dry-run --no-deps
./scripts/install.sh --no-deps
```

Existing differing destinations are backed up privately before copy-mode
replacement. `--link` links tracked files individually; `--force` permits
backing up link-mode conflicts. Dry-run makes no changes. `*.example` files
are never installed. Check the script's help for current options.

Dependency installation executes package scripts and uses the network. Omit
`--no-deps` only after reviewing the local package manifests, or install runtime
dependencies manually in the applicable deployed package directory. Do not run
npm across every folder indiscriminately.

### Complete setup order

1. Clone and install the portable files as above. `--no-deps` is intentional
   because Pi and its managed Node are not installed yet.
2. Create the machine-local Git identity. The public `.gitconfig` includes this
   file and deliberately ships no identity or plaintext credential helper:

   ```sh
   cat > ~/.gitconfig.local <<'EOF'
   [user]
       name = Your Name
       email = you@example.com
   EOF
   ```

3. Install Pi from the official installer, which also provides a managed Node:

   ```sh
   curl -fsSL https://pi.dev/install.sh | sh
   ```

4. Start `pi` once and authenticate your providers. It installs the npm package
   sources listed in `settings.json`. The checked-in default is
   `deepseek-v4.1-flash` on `opencode-go`; if that account is unavailable,
   select your own model or edit those two keys.

5. Install runtime dependencies for the local Pi packages. Pi does not install
   or modify local packages, and `pi-subagents` needs `croner` and `nanoid`:

   ```sh
   export PATH="${XDG_DATA_HOME:-$HOME/.local/share}/pi-node/current/bin:$PATH"
   (cd ~/.pi/agent/packages/pi-subagents && \
     npm install --omit=dev --legacy-peer-deps)
   ```

   Only `pi-subagents` declares runtime dependencies; the other local packages
   are dependency-free.

6. Verify the deployed tree:

   ```sh
   ~/dotfiles/scripts/check-pi-extension-imports.sh
   pi list
   ```

   `pi list` should show the local `./packages/pi-context-bar` and
   `./packages/pi-split-view` entries, not upstream npm replacements.

On Windows, use the Pi PowerShell installer for step 3 and Git Bash for the
Bash scripts. The Linux desktop parts do not apply. Zed on
Windows reads `%APPDATA%\Zed`, not `~/.config/zed`.

### Machine-local settings

These paths are ignored and excluded from the public snapshot:

- `~/.bashrc.local` is sourced by `.bashrc`.
- `~/.zshrc.local` is sourced by `.zshrc`.
- `~/.gitconfig.local` is included by `.gitconfig` for Git identity and
  host-specific helpers. Do not enable plaintext credential storage.

```sh
cat > ~/.bashrc.local <<'EOF'
export TAVILY_API_KEY="..."
export SEARXNG_URL="https://your-searxng.example"
EOF

cat > ~/.zshrc.local <<'EOF'
export TAVILY_API_KEY="..."
EOF
```

- Configure search/extraction services through `SEARXNG_URL` and
  `SELFHOSTED_EXTRACT_URL`. Defaults are localhost ports 8888 and 8899; those
  services must be installed separately. There is no maintainer network
  fallback.
- Customize application examples locally; do not capture real host aliases,
  absolute home paths, disk IDs, network identities, or secrets into Git.
- Wallpaper state is generated by the picker/restore scripts, not tracked.

All setup instructions in this README target the public `aandrx/dotfiles`
repository. The separate `aandrx/dotfiles-private` archive is not a setup
source and must remain private.

The public tree intentionally differs from the maintainer's live files. A
privacy refusal is not a reason to force-add the live copy.

## Updating safely

Edit portable settings in this repository, not private copies. Capture only
reviewed tracked paths when needed:

```sh
./scripts/capture.sh --dry-run .config/kitty/kitty.conf
./scripts/capture.sh .config/kitty/kitty.conf
python3 -m unittest discover -s scripts/tests -v
python3 scripts/privacy-check.py
./scripts/check-pi-extension-imports.sh
git diff --check
# Stage each intended file explicitly, then validate the actual index:
python3 scripts/privacy-check.py --staged
```

Capture validates candidates before writing, does not add new files, and
skips examples. Refusals block the operation. Do not paste raw private diffs
or scanner matches into chat/issues. Report paths, lines, and rule names only.

For Gitleaks, optional local hooks, CI, incident handling, and the history
release gate, see `PRIVACY.md`. Commits, pushes, live deployment and publication
remain separate explicit actions. No agent should infer permission to publish
from a request to synchronize configuration.
