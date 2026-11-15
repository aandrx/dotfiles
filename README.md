# dotfiles

My Linux desktop and Pi setup, kept as plain files.

This public repository is a curated, reduced reference snapshot. It is not a
backup of my machine and not a drop-in distribution. The full live setup and the
private source stay private.

Before changing anything, read [AGENTS.md](AGENTS.md) for agent and contributor
bounds and [PRIVACY.md](PRIVACY.md) for the public-release policy. The complete
setup and maintenance guide is in [QUICKSTART.md](QUICKSTART.md).

## Using this repo

These are my personal dotfiles, shared so people can read, learn from, and fork
them. Configuration pull requests are not accepted: the public configuration is
generated from a private source and updated on my schedule. Please open an issue
for a reproducible bug in the published scripts or documentation.

## What you get

The snapshot contains working examples and the tooling around them:

- Niri and Hyprland configuration examples, with a two-profile Waybar setup.
- SwayNC, Matugen, Rofi, Wlogout, Kitty, Cava, Zed, Neovim, tmux and fastfetch
  examples.
- Pi roles, skills, workflows, extensions and local packages, including the
  patched context bar and split view.
- Install, capture and privacy-check scripts, with tests and CI.
- No credentials, provider authentication, Pi sessions, personal notes or
  machine-level system configuration.

The desktop files are examples. Expect to adjust monitors, keybindings, fonts,
palettes and application choices for your own machine.

## Prerequisites

- Linux with Wayland for the desktop configuration. The installer is tested on
  Linux; macOS needs compatible tools, and the Linux desktop files do not apply.
- Git, Python 3.10+, Bash 4+, and GNU coreutils.
- Pi is optional. Install it separately if you want the agent setup.

## Fresh-machine setup

Review the source first. This installs into your home directory, so start with a
dry run:

```sh
git clone https://github.com/aandrx/dotfiles.git ~/dotfiles
cd ~/dotfiles
./scripts/install.sh --dry-run --no-deps
./scripts/install.sh --no-deps
```

`--no-deps` is intentional when Pi is not installed yet. It installs the tracked
files without running package installation.

Then follow [QUICKSTART.md](QUICKSTART.md) for the remaining order: Git identity,
Pi, provider authentication, machine-local environment files, and the runtime
dependencies for the local Pi packages.

## Daily use

Edit the files in your checkout, review the planned installation, then apply it:

```sh
./scripts/install.sh --dry-run --no-deps
./scripts/install.sh --no-deps
```

Existing differing destinations are backed up before copy-mode replacement.
`--link` links tracked files individually, and `--force` permits backing up
link-mode conflicts. Run `./scripts/install.sh --help` for the current options.

## Make it yours

- Create `~/.gitconfig.local` for your Git identity. The public `.gitconfig`
  deliberately ships no identity or plaintext credential helper.
- Create `~/.bashrc.local` or `~/.zshrc.local` for local service endpoints and
  API keys. These files are ignored and excluded from the public snapshot.
- Adjust monitor names, hardware settings and application examples for your
  machine. The public examples are reduced on purpose.
- Never commit credentials, cookies, private keys, real host aliases, Wi-Fi
  profiles, absolute home paths, disk identifiers or machine notes.

The exact local setup sequence is in [QUICKSTART.md](QUICKSTART.md).

## Repo tour

| Path | What it is |
| --- | --- |
| `.config/` | Portable application configuration examples. |
| `.pi/agent/` | Pi instructions, roles, extensions, skills, workflows and local packages. |
| `bin/` and `.pi/bin/` | Small home-directory utilities. |
| root shell files | Shell, editor and Git configuration. |
| `scripts/` | Install, capture, privacy-check and repository maintenance tooling. |
| `QUICKSTART.md` | Full installation, Pi setup, local settings and update guide. |
| `AGENTS.md` | Agent and contributor instructions and bounds. |
| `PRIVACY.md` | Publication policy, checks and incident handling. |

## How the public tree works

The repository uses ordinary folders and real filenames. There is no chezmoi,
templating layer or hidden capture daemon. `.config/example/` is installed as
`~/.config/example/`, and installers consume the tracked manifest rather than
every file that happens to be in the checkout.

The public tree is a reduced snapshot exported from a private source. Some
configuration trees are replaced wholesale with smaller examples, and some
files are excluded entirely. Missing profiles, helper scripts, generated
palettes and assets are often deliberate. Do not edit public configuration to
make it match a live machine; the public copies are generated, not authored
here.

## Pi setup

Pi is optional and is not installed by this repository. Install it from the
[official Pi instructions](https://pi.dev), then authenticate your own
providers.

The local Pi packages are referenced by path from `settings.json`. Keep those
`./packages/...` references; replacing them with npm sources loses the local
changes. The patched packages and their provenance notes are under
`.pi/agent/packages/`.

Sessions, authentication, trust decisions, caches and the installed Pi runtime
are not part of this repository. See [QUICKSTART.md](QUICKSTART.md) for the
first-run sequence and runtime dependencies.

## Agent and privacy rules

Read [AGENTS.md](AGENTS.md) before making changes and [PRIVACY.md](PRIVACY.md)
before adding anything to Git. The public configuration is generated; public
config PRs are closed rather than merged. If you are changing configuration,
change the private source and regenerate the snapshot.

The public privacy checker and CI run before publication. A clean scan is
evidence, not proof of privacy. Report potential secrets by path and rule only,
never by pasting the value or a content-bearing diff into an issue or chat.

## Notes

The public examples intentionally differ from the maintainer's live machine.
Window managers, bars and terminals usually need adaptation. Wallpaper state
and generated palettes are not tracked. Pi authentication, sessions and local
model credentials are installed separately and are never published.

The repository does not include machine-level system configuration, TLP, grub
or udev files.

## License

Original work is MIT-licensed under [LICENSE](LICENSE). Third-party components
keep their own licenses; see [NOTICE.md](NOTICE.md).
