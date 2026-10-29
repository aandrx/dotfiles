#!/usr/bin/env bash
# install-system.sh - deploy the tracked system/ tree to the filesystem root.
#
# system/ mirrors /:
#
#   system/etc/default/grub                        -> /etc/default/grub
#   system/etc/udev/rules.d/*.rules                -> /etc/udev/rules.d/
#   system/etc/pacman.d/hooks/*.hook               -> /etc/pacman.d/hooks/
#   system/usr/local/sbin/<script>                 -> /usr/local/sbin/ (mode 755)
#
# Real writes require an explicit --apply. The default is a dry run. Existing
# files are backed up under /var/backups/dotfiles-system before replacement.
# Files ending in .example are templates and are skipped.
#
# Usage:
#   ./scripts/install-system.sh --dry-run
#   sudo ./scripts/install-system.sh --apply
#   ./scripts/install-system.sh --apply --root /tmp/test-root   # tests only
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_ROOT="$REPO/system"
CHECK="$REPO/scripts/privacy-check.py"
APPLY=0
ROOT="/"
BACKUP_DIR=""
status=0

usage() {
  cat <<'EOF'
Usage: scripts/install-system.sh [--dry-run] [--apply] [--root PATH]

  --dry-run    Print actions without changing anything (default).
  --apply      Write files. Real root requires root privileges.
  --root PATH  Isolated destination root for tests; requires --apply.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -n|--dry-run) APPLY=0 ;;
    --apply) APPLY=1 ;;
    --root)
      [ "$#" -ge 2 ] || { printf 'install-system.sh: --root needs a path\n' >&2; exit 2; }
      ROOT="$2"
      shift
      ;;
    --root=*) ROOT="${1#--root=}" ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'install-system.sh: unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[ -d "$SRC_ROOT" ] || {
  printf 'install-system.sh: no system/ tree in %s\n' "$REPO" >&2
  exit 1
}
[ -f "$CHECK" ] || {
  printf 'install-system.sh: missing privacy checker: %s\n' "$CHECK" >&2
  exit 1
}
command -v python3 >/dev/null 2>&1 || {
  printf 'install-system.sh: python3 is required for privacy checks\n' >&2
  exit 1
}

ROOT="${ROOT%/}"
[ -n "$ROOT" ] || ROOT=/
if [ "$ROOT" != "/" ]; then
  if [ -L "$ROOT" ]; then
    printf 'install-system.sh: --root must not be a symlink: %s\n' "$ROOT" >&2
    exit 2
  fi
  if [ -e "$ROOT" ] && [ ! -d "$ROOT" ]; then
    printf 'install-system.sh: --root is not a directory: %s\n' "$ROOT" >&2
    exit 2
  fi
fi
ROOT_REAL="$(realpath -m -- "$ROOT")"
if [ "$ROOT" != "/" ] && [ "$ROOT_REAL" = / ]; then
  printf 'install-system.sh: --root must be an isolated non-root directory\n' >&2
  exit 2
fi

if [ "$APPLY" -eq 1 ] && [ "$ROOT_REAL" = / ] && [ "$(id -u)" -ne 0 ]; then
  printf 'install-system.sh: real writes require root: sudo %s --apply\n' "$0" >&2
  exit 1
fi

backup_ancestry_unsafe() {
  local cur="$ROOT_REAL" part
  local parts=()
  IFS='/' read -r -a parts <<< "var/backups/dotfiles-system"
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

new_backup_dir() {
  local stamp
  stamp="$(date +%Y%m%d-%H%M%S)"
  backup_ancestry_unsafe && return 1
  mkdir -p "$ROOT_REAL/var/backups/dotfiles-system"
  chmod 700 "$ROOT_REAL/var/backups/dotfiles-system"
  BACKUP_DIR="$(mktemp -d "$ROOT_REAL/var/backups/dotfiles-system/$stamp-XXXXXX")"
  chmod 700 "$BACKUP_DIR"
}

backup_dest() {
  local rel="$1" dest="$2"
  if [ "$APPLY" -eq 0 ]; then
    printf 'backup %s -> /var/backups/dotfiles-system/DRYRUN/%s\n' "$dest" "$rel"
    return 0
  fi
  if [ -z "$BACKUP_DIR" ] && ! new_backup_dir; then
    printf 'install-system.sh: refusing unsafe backup directory ancestry\n' >&2
    status=1
    return 1
  fi
  (umask 077; mkdir -p "$BACKUP_DIR/$(dirname "$rel")")
  cp -a -- "$dest" "$BACKUP_DIR/$rel"
}

ancestor_unsafe() {
  local dest="$1" parent cur part
  parent="$(dirname "$dest")"
  cur="$ROOT_REAL"
  [ "$parent" = "$ROOT_REAL" ] && return 1
  local rel="${parent#"$ROOT_REAL"}"
  rel="${rel#/}"
  IFS='/' read -r -a parts <<< "$rel"
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

if backup_ancestry_unsafe; then
  printf 'install-system.sh: refusing unsafe backup directory ancestry under %s\n' "$ROOT_REAL" >&2
  exit 1
fi

# Validate every eligible source and destination boundary before any write.
candidates=()
while IFS= read -r -d '' tracked; do
  rel="${tracked#system/}"
  case "$rel" in
    *.example) continue ;;
  esac
  if python3 "$CHECK" --denied "system/$rel" >/dev/null 2>&1; then
    printf 'skip denied path %s\n' "$rel"
    continue
  fi
  if ! python3 "$CHECK" --file "system/$rel" "$SRC_ROOT/$rel"; then
    printf 'install-system.sh: refusing unsafe source: %s\n' "$rel" >&2
    status=1
    continue
  fi
  dest="$ROOT_REAL/$rel"
  ancestor_unsafe "$dest" && {
    printf 'install-system.sh: refusing symlinked target ancestor for %s\n' "$dest" >&2
    status=1
    continue
  }
  if [ -d "$dest" ] && [ ! -L "$dest" ]; then
    printf 'install-system.sh: destination is a directory: %s\n' "$dest" >&2
    status=1
    continue
  fi
  candidates+=("$rel")
done < <(git -C "$REPO" ls-files -z -- system | sort -z)

if [ "$status" -ne 0 ]; then
  printf 'install-system.sh: preflight failed; nothing was written\n' >&2
  exit 1
fi

count=0
backed=0
if [ "${#candidates[@]}" -gt 0 ]; then
  for rel in "${candidates[@]}"; do
    dest="$ROOT_REAL/$rel"
    src="$SRC_ROOT/$rel"
    case "$rel" in
      usr/local/sbin/*) desired=755 ;;
      *) desired=644 ;;
    esac

    if [ -f "$dest" ] && [ ! -L "$dest" ]; then
      actual_mode="$(stat -c %a "$dest")"
      case "$rel" in
        usr/local/sbin/*) mode=755 ;;
        *) mode="$actual_mode" ;;
      esac
      if cmp -s "$src" "$dest"; then
        if [ "$mode" = "$actual_mode" ]; then
          printf 'unchanged %s\n' "$dest"
          continue
        fi
        if [ "$APPLY" -eq 0 ]; then
          printf 'chmod %s %s\n' "$mode" "$dest"
        else
          chmod "$mode" "$dest"
          printf 'mode %s -> %s\n' "$dest" "$mode"
        fi
        count=$((count + 1))
        continue
      fi
    else
      mode="$desired"
    fi

    if [ "$APPLY" -eq 1 ] && { [ -e "$dest" ] || [ -L "$dest" ]; }; then
      backup_dest "$rel" "$dest" || continue
      backed=$((backed + 1))
    elif [ "$APPLY" -eq 0 ] && { [ -e "$dest" ] || [ -L "$dest" ]; }; then
      printf 'backup %s -> /var/backups/dotfiles-system/DRYRUN/%s\n' "$dest" "$rel"
    fi

    if [ "$APPLY" -eq 0 ]; then
      printf 'install -D -m %s %s -> %s\n' "$mode" "$rel" "$dest"
    else
      if [ -L "$dest" ]; then
        rm -f "$dest"
      fi
      install -D -m "$mode" "$src" "$dest"
      printf 'installed %s (mode %s)\n' "$dest" "$mode"
    fi
    count=$((count + 1))
  done
fi

if [ "$APPLY" -eq 0 ]; then
  printf '%s file(s) would be installed; dry run changed nothing\n' "$count"
else
  printf '%s file(s) installed, %s backed up\n' "$count" "$backed"
fi
[ "$status" -eq 0 ] || exit 1
