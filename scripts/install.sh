#!/usr/bin/env bash
# install.sh - deploy this repository's tracked public files into $HOME.
#
# Only git-tracked paths are considered. Ignored notes and runtime files that
# happen to live in the repository are never copied or linked. Credential
# stores and private note paths are skipped. *.example files are templates and
# are not installed.
#
# Copy mode backs up any differing file or symlink before replacing it. Link
# mode links individual tracked files, never whole directories.
#
# Usage:
#   ./scripts/install.sh                 copy tracked files into $HOME
#   ./scripts/install.sh --dry-run       show what would change
#   ./scripts/install.sh --link          symlink tracked files into $HOME
#   ./scripts/install.sh --force         back up conflicts before linking
#   ./scripts/install.sh --no-deps       skip npm dependency installation
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$REPO/scripts/privacy-check.py"
MODE=copy
DRY_RUN=0
FORCE=0
DEPS=1
BACKUP_DIR=""
status=0

usage() {
  cat <<'EOF'
Usage: scripts/install.sh [--copy|--link] [--dry-run] [--force] [--no-deps]

  --copy      Copy tracked files into $HOME (default).
  --link      Symlink individual tracked files into $HOME.
  --dry-run   Print actions without changing anything.
  --force     With --link, back up conflicting files before linking.
  --no-deps   Do not install npm dependencies.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --copy) MODE=copy ;;
    --link) MODE=link ;;
    -n|--dry-run) DRY_RUN=1 ;;
    -f|--force) FORCE=1 ;;
    --no-deps) DEPS=0 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'install.sh: unknown argument: %s\n' "$arg" >&2; usage >&2; exit 2 ;;
  esac
done

command -v python3 >/dev/null 2>&1 || {
  printf 'install.sh: python3 is required for privacy checks\n' >&2
  exit 1
}
[ -f "$CHECK" ] || {
  printf 'install.sh: missing privacy checker: %s\n' "$CHECK" >&2
  exit 1
}

say() { printf '%s\n' "$*"; }

linux_skip() {
  local rel="$1"
  [ "$(uname -s)" = Linux ] && return 1
  case "$rel" in
    .config/autostart|.config/autostart/*|\
    .config/environment.d|.config/environment.d/*|\
    .config/hypr|.config/hypr/*|\
    .config/matugen|.config/matugen/*|\
    .config/niri|.config/niri/*|\
    .config/rofi|.config/rofi/*|\
    .config/swaync|.config/swaync/*|\
    .config/swww|.config/swww/*|\
    .config/waybar|.config/waybar/*|\
    .config/waybar-niri|.config/waybar-niri/*|\
    .config/wlogout|.config/wlogout/*|\
    .config/xdg-desktop-portal|.config/xdg-desktop-portal/*)
      return 0
      ;;
  esac
  return 1
}

is_home_path() {
  case "$1" in
    .config/*|.pi/*|bin/*) return 0 ;;
    .bash_profile|.bashrc|.condarc|.gitconfig|.npmrc|.profile|.zshrc) return 0 ;;
  esac
  return 1
}

# Validate every deployable tracked source before any backup or write. The
# checker is imported so denied tracked fixtures are filtered out instead of
# making the whole-tree scan fail.
validate_sources() {
  [ "$#" -gt 0 ] || return 0
  python3 - "$REPO" "$CHECK" "$@" <<'PY'
import importlib.util
import sys
from pathlib import Path

repo = Path(sys.argv[1])
check = Path(sys.argv[2])
rels = sys.argv[3:]
spec = importlib.util.spec_from_file_location("privacy_check", check)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
tracked = set(module.tracked_paths(repo))
findings = []
for rel in rels:
    findings.extend(module.scan_worktree_file(repo, rel, tracked))
for finding in findings:
    print(f"privacy: {finding.path}: {finding.rule}", file=sys.stderr)
sys.exit(1 if findings else 0)
PY
}

is_denied() {
  python3 "$CHECK" --denied "$1" >/dev/null 2>&1
}

is_private() {
  case "$1" in
    .npmrc|.config/htop/htoprc|.config/zed/settings.json|.config/zed/settings_backup.json)
      return 0
      ;;
  esac
  return 1
}

source_unsafe() {
  local src="$1" target resolved
  [ -L "$src" ] || return 1
  target="$(readlink "$src")"
  case "$target" in
    /*) return 0 ;;
  esac
  resolved="$(realpath -m -- "$src")"
  case "$resolved" in
    "$REPO"|"$REPO"/*) return 1 ;;
    *) return 0 ;;
  esac
}

ancestor_unsafe() {
  local rel="$1" dir part cur="$HOME"
  dir="$(dirname "$rel")"
  [ "$dir" = "." ] && return 1
  IFS='/' read -r -a parts <<< "$dir"
  for part in "${parts[@]}"; do
    [ -n "$part" ] || continue
    cur="$cur/$part"
    if [ -L "$cur" ]; then
      return 0
    fi
    if [ -e "$cur" ] && [ ! -d "$cur" ]; then
      return 0
    fi
  done
  return 1
}

refuse_repo_target() {
  local rel="$1" src="$REPO/$1" dest="$HOME/$1"
  [ -e "$dest" ] || [ -L "$dest" ] || return 1
  if [ "$dest" -ef "$src" ]; then
    printf 'install.sh: refusing to replace repository source through ~/%s\n' "$rel" >&2
    status=1
    return 0
  fi
  if [ -L "$dest" ]; then
    case "$(realpath -m -- "$dest")" in
      "$REPO"|"$REPO"/*)
        printf 'install.sh: refusing to replace repository source through ~/%s\n' "$rel" >&2
        status=1
        return 0
        ;;
    esac
  fi
  return 1
}

new_backup_dir() {
  local stamp
  stamp="$(date +%Y%m%d-%H%M%S)"
  BACKUP_DIR="$(mktemp -d "$HOME/.dotfiles-backup-$stamp-XXXXXX")"
  chmod 700 "$BACKUP_DIR"
}

backup_dest() {
  local rel="$1" dest="$HOME/$1"
  if [ "$DRY_RUN" -eq 1 ]; then
    say "backup ~/$rel -> ~/.dotfiles-backup-DRYRUN/$rel"
    return 0
  fi
  [ -n "$BACKUP_DIR" ] || new_backup_dir
  (umask 077; mkdir -p "$BACKUP_DIR/$(dirname "$rel")")
  mv "$dest" "$BACKUP_DIR/$rel"
}

copy_file() {
  local rel="$1" src="$REPO/$1" dest="$HOME/$1"
  linux_skip "$rel" && return 0
  ancestor_unsafe "$rel" && {
    printf 'install.sh: refusing symlinked target ancestor for ~/%s\n' "$rel" >&2
    status=1
    return 0
  }
  source_unsafe "$src" && {
    printf 'install.sh: refusing unsafe source symlink for %s\n' "$rel" >&2
    status=1
    return 0
  }

  if [ -d "$dest" ] && [ ! -L "$dest" ]; then
    printf 'install.sh: ~/%s is a directory, expected a file\n' "$rel" >&2
    status=1
    return 0
  fi

  # A preserved relative symlink is already installed when its target matches.
  # Comparing link metadata also avoids dereferencing it during this check.
  if [ -L "$src" ] && [ -L "$dest" ] && \
     [ "$(readlink "$src")" = "$(readlink "$dest")" ]; then
    return 0
  fi

  if [ -f "$dest" ] && [ ! -L "$dest" ] && cmp -s "$src" "$dest"; then
    # HOME=REPO deploys files onto themselves; never chmod the source inode.
    if is_private "$rel" && [ "$(stat -c %a "$dest")" != 600 ] && \
       ! [ "$dest" -ef "$src" ] && [ "$DRY_RUN" -eq 0 ]; then
      chmod 600 "$dest"
    fi
    return 0
  fi

  refuse_repo_target "$rel" && return 0
  if [ -e "$dest" ] || [ -L "$dest" ]; then
    backup_dest "$rel"
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    say "copy   ~/$rel"
    is_private "$rel" && say "chmod  600 ~/$rel"
    return 0
  fi

  mkdir -p "$(dirname "$dest")"
  cp -pP "$src" "$dest"
  if is_private "$rel"; then
    chmod 600 "$dest"
  fi
}

link_file() {
  local rel="$1" src="$REPO/$1" dest="$HOME/$1"
  linux_skip "$rel" && return 0
  ancestor_unsafe "$rel" && {
    printf 'install.sh: refusing symlinked target ancestor for ~/%s\n' "$rel" >&2
    status=1
    return 0
  }
  source_unsafe "$src" && {
    printf 'install.sh: refusing unsafe source symlink for %s\n' "$rel" >&2
    status=1
    return 0
  }

  if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then
    return 0
  fi

  if [ -d "$dest" ] && [ ! -L "$dest" ]; then
    printf 'install.sh: ~/%s is a directory, expected a file\n' "$rel" >&2
    status=1
    return 0
  fi

  refuse_repo_target "$rel" && return 0
  if [ -e "$dest" ] || [ -L "$dest" ]; then
    if [ "$FORCE" -ne 1 ]; then
      printf 'install.sh: ~/%s already exists; rerun with --force to back it up\n' "$rel" >&2
      status=1
      return 0
    fi
    backup_dest "$rel"
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    say "link   ~/$rel -> $src"
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  ln -s "$src" "$dest"
}

has_dependencies() {
  python3 - "$1" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        data = json.load(handle)
except (OSError, ValueError):
    sys.exit(2)
deps = {}
for key in ("dependencies", "optionalDependencies"):
    value = data.get(key)
    if isinstance(value, dict):
        deps.update(value)
sys.exit(0 if deps else 1)
PY
}

install_deps() {
  local rel pkg pkg_dir manifest
  [ "$MODE" = copy ] || return 0
  [ "$DEPS" -eq 1 ] || return 0
  [ "$status" -eq 0 ] || {
    say "skipping dependencies because deployment had conflicts"
    return 0
  }
  # Only tracked, deployable package manifests are considered. Ignored local
  # manifests are neither read nor executed.
  while IFS= read -r -d '' rel; do
    case "$rel" in
      .pi/agent/packages/*/package.json) ;;
      *) continue ;;
    esac
    case "${rel#.pi/agent/packages/}" in
      */package.json)
        rest="${rel#.pi/agent/packages/}"
        rest="${rest%/package.json}"
        case "$rest" in
          ""|*/*) continue ;;
        esac
        ;;
      *) continue ;;
    esac
    is_home_path "$rel" || continue
    is_denied "$rel" && continue
    manifest="$REPO/$rel"
    pkg="$(basename "$(dirname "$manifest")")"
    pkg_dir="$HOME/.pi/agent/packages/$pkg"
    [ -d "$pkg_dir/node_modules" ] && continue
    if has_dependencies "$manifest"; then
      :
    else
      dep_status=$?
      case "$dep_status" in
        1) continue ;;
        *)
          printf 'install.sh: cannot read dependency metadata for %s\n' "$manifest" >&2
          status=1
          continue
          ;;
      esac
    fi
    if ! command -v node >/dev/null 2>&1; then
      printf 'install.sh: Node.js is required for %s dependencies (package metadata: %s)\n' "$pkg" "$manifest" >&2
      status=1
      continue
    fi
    if ! command -v npm >/dev/null 2>&1; then
      printf 'install.sh: npm is required for %s dependencies (package metadata: %s)\n' "$pkg" "$manifest" >&2
      status=1
      continue
    fi
    if [ "$DRY_RUN" -eq 1 ]; then
      say "npm    install $pkg"
      continue
    fi
    say "installing dependencies for $pkg"
    if ! ( cd "$pkg_dir" && npm install --omit=dev --legacy-peer-deps --no-audit --no-fund >/dev/null ); then
      printf 'install.sh: npm install failed in %s\n' "$pkg_dir" >&2
      status=1
    fi
  done < <(git -C "$REPO" ls-files -z -- '.pi/agent/packages/*/package.json')
}

say "repository: $REPO"
say "mode:       $MODE$([ "$DRY_RUN" -eq 1 ] && echo ' (dry run)')"

[ -d "$HOME" ] && [ ! -L "$HOME" ] || {
  printf 'install.sh: HOME must be a real directory, not a symlink: %s\n' "$HOME" >&2
  exit 1
}

eligible=()
while IFS= read -r -d '' rel; do
  is_home_path "$rel" || continue
  case "$rel" in
    *.example) continue ;;
  esac
  is_denied "$rel" && continue
  [ -e "$REPO/$rel" ] || [ -L "$REPO/$rel" ] || continue
  eligible+=("$rel")
done < <(git -C "$REPO" ls-files -z | sort -z)

if [ "${#eligible[@]}" -gt 0 ] && ! validate_sources "${eligible[@]}"; then
  say "preflight failed; nothing changed"
  exit 1
fi

deployed=0
for rel in "${eligible[@]}"; do
  if [ "$MODE" = link ]; then
    link_file "$rel"
  else
    copy_file "$rel"
  fi
  deployed=$((deployed + 1))
done

install_deps

say "$deployed tracked file(s) processed"
if [ "$status" -ne 0 ]; then
  say "finished with errors"
  exit 1
elif [ "$DRY_RUN" -eq 1 ]; then
  say "dry run complete; nothing changed"
else
  say "done"
fi
