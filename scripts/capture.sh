#!/usr/bin/env bash
# capture.sh - copy live configuration back into this repository.
#
# Only paths that are already tracked are captured. New files must be added
# deliberately with `git add`. Credential paths and private machine notes are
# refused, and every candidate is checked before any file is written.
#
# Most tracked paths mirror $HOME. Paths under system/ mirror the filesystem
# root instead, so system/etc/tlp.conf is captured from /etc/tlp.conf. Files
# ending in .example are public templates and are never re-imported.
#
# Usage:
#   ./scripts/capture.sh                 update tracked files from $HOME
#   ./scripts/capture.sh --dry-run       list files that would change
#   ./scripts/capture.sh PATH...         restrict capture to tracked paths
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$REPO/scripts/privacy-check.py"
DRY_RUN=0
EXPLICIT=0
EXPLICIT_PATHS=()
UPDATED=()
REFUSED=0

usage() {
  printf 'Usage: scripts/capture.sh [--dry-run] [PATH...]\n'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -n|--dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    --) shift; EXPLICIT=1; EXPLICIT_PATHS+=("$@"); break ;;
    -*) printf 'capture.sh: unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
    *) EXPLICIT=1; EXPLICIT_PATHS+=("$1") ;;
  esac
  shift
done

command -v python3 >/dev/null 2>&1 || {
  printf 'capture.sh: python3 is required for privacy checks\n' >&2
  exit 1
}
[ -f "$CHECK" ] || {
  printf 'capture.sh: missing privacy checker: %s\n' "$CHECK" >&2
  exit 1
}

in_scope() {
  case "$1" in
    .config/*|.pi/*|bin/*|system/*|.bash_profile|.bashrc|.condarc|.gitconfig|.npmrc|.profile|.zshrc)
      return 0
      ;;
  esac
  return 1
}

is_denied() {
  python3 "$CHECK" --denied "$1" >/dev/null 2>&1
}

# Never write through a symlinked repository ancestor.
dest_ancestor_unsafe() {
  local rel="$1" dir part cur="$REPO"
  dir="$(dirname "$rel")"
  [ "$dir" = "." ] && return 1
  local parts=()
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

changed() {
  local src="$1" dest="$2"
  if [ -L "$src" ] || [ -L "$dest" ]; then
    [ "$(readlink "$src" 2>/dev/null || true)" = "$(readlink "$dest" 2>/dev/null || true)" ] && return 1
    return 0
  fi
  cmp -s "$src" "$dest" && return 1
  return 0
}

source_for() {
  case "$1" in
    system/*) printf '/%s\n' "${1#system/}" ;;
    *) printf '%s/%s\n' "$HOME" "$1" ;;
  esac
}

mapfile -d '' -t TRACKED < <(git -C "$REPO" ls-files -z)

selected=()
if [ "$EXPLICIT" -eq 1 ]; then
  declare -A seen=()
  for arg in "${EXPLICIT_PATHS[@]}"; do
    rel="${arg#./}"
    case "$rel" in
      ""|/*|..|../*|*/../*)
        printf 'capture.sh: path is outside the repository: %s\n' "$arg" >&2
        exit 2
        ;;
    esac
    matched=0
    for tracked in "${TRACKED[@]}"; do
      case "$tracked" in
        "$rel"|"$rel"/*)
          if [ -z "${seen[$tracked]:-}" ]; then
            seen["$tracked"]=1
            selected+=("$tracked")
          fi
          matched=1
          ;;
      esac
    done
    if [ "$matched" -eq 0 ]; then
      printf 'capture.sh: not a tracked path: %s\n' "$arg" >&2
      exit 2
    fi
  done
else
  selected=("${TRACKED[@]}")
fi

# Preflight every candidate. Nothing is written until all checks pass.
PENDING=()
for rel in "${selected[@]}"; do
  in_scope "$rel" || continue
  case "$rel" in
    *.example) continue ;;
  esac
  if is_denied "$rel"; then
    if [ "$EXPLICIT" -eq 1 ]; then
      printf 'refused: %s is a denied credential or private path\n' "$rel" >&2
      REFUSED=1
    fi
    continue
  fi
  src="$(source_for "$rel")"
  dest="$REPO/$rel"
  if dest_ancestor_unsafe "$rel"; then
    printf 'refused: %s has a symlinked repository ancestor\n' "$rel" >&2
    REFUSED=1
    continue
  fi
  { [ -e "$src" ] || [ -L "$src" ]; } || continue
  if [ -L "$src" ]; then
    # Compare leaf symlink metadata only; never dereference a changed link.
    if [ -L "$dest" ] && [ "$(readlink "$src")" = "$(readlink "$dest")" ]; then
      continue
    fi
    python3 "$CHECK" --file "$rel" "$src" || true
    printf 'refused: %s is a changed symlink and cannot be captured safely\n' "$rel" >&2
    REFUSED=1
    continue
  fi
  # Validate regular source metadata and content before any comparison read.
  if ! python3 "$CHECK" --file "$rel" "$src"; then
    printf 'refused: %s failed the privacy check\n' "$rel" >&2
    REFUSED=1
    continue
  fi
  changed "$src" "$dest" || continue
  PENDING+=("$rel")
done

if [ "$REFUSED" -ne 0 ]; then
  printf 'capture aborted; no files were written\n' >&2
  exit 1
fi

for rel in "${PENDING[@]}"; do
  src="$(source_for "$rel")"
  dest="$REPO/$rel"
  if [ "$DRY_RUN" -eq 1 ]; then
    printf 'update %s\n' "$rel"
    continue
  fi
  mkdir -p "$(dirname "$dest")"
  rm -f "$dest"
  case "$rel" in
    # System sources are root-owned; -p would try and fail to preserve that.
    system/*) cp "$src" "$dest" ;;
    *)        cp -pP "$src" "$dest" ;;
  esac
  printf 'updated %s\n' "$rel"
done

if [ "$DRY_RUN" -eq 1 ]; then
  printf '%s file(s) would be updated\n' "${#PENDING[@]}"
else
  printf '%s file(s) updated\n' "${#PENDING[@]}"
fi
