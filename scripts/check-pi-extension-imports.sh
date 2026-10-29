#!/usr/bin/env bash
# check-pi-extension-imports.sh - validate the tracked pi agent tree.
#
# Checks that relative TypeScript imports resolve, that tracked JSON
# configuration parses, and that tracked credential/private paths are refused.
# Ignored local notes may remain in the worktree; only tracked paths are checked.
set -euo pipefail

ROOT="${DOTFILES_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
CHECK="$ROOT/scripts/privacy-check.py"
fail=0

command -v python3 >/dev/null 2>&1 || {
  printf 'ERROR: python3 is required\n' >&2
  exit 1
}
[ -f "$CHECK" ] || {
  printf 'ERROR: missing privacy checker: %s\n' "$CHECK" >&2
  exit 1
}

mapfile -d '' -t TRACKED < <(git -C "$ROOT" ls-files -z)

for rel in "${TRACKED[@]}"; do
  if python3 "$CHECK" --denied "$rel" >/dev/null 2>&1; then
    printf 'ERROR: tracked private or credential path: %s\n' "$rel" >&2
    fail=1
  fi
done

for rel in "${TRACKED[@]}"; do
  case "$rel" in
    .pi/agent/extensions/*.ts) ;;
    *) continue ;;
  esac
  file="$ROOT/$rel"
  [ -f "$file" ] || continue
  while IFS= read -r ref; do
    target="$(cd "$(dirname "$file")" && pwd)/$ref"
    if [ ! -f "$target" ]; then
      printf 'ERROR: %s imports missing file %s\n' "$file" "$ref" >&2
      fail=1
    fi
  done < <(grep -hoE "from ['\"]\\.{1,2}/[^'\"]+\\.ts['\"]" "$file" | sed -E "s/^from ['\"]//; s/['\"]$//" || true)
done

for rel in "${TRACKED[@]}"; do
  case "$rel" in
    .pi/agent/settings.json|.pi/agent/subagents.json|.pi/agent/packages/*/package.json) ;;
    *) continue ;;
  esac
  json="$ROOT/$rel"
  [ -f "$json" ] || continue
  python3 -m json.tool "$json" >/dev/null 2>&1 || {
    printf 'ERROR: invalid JSON: %s\n' "$json" >&2
    fail=1
  }
done

if [ -f "$ROOT/.pi/agent/settings.json" ]; then
  while IFS= read -r src; do
    [ -n "$src" ] || continue
    rel="${src#./}"
    if [ ! -e "$ROOT/.pi/agent/$rel" ]; then
      printf 'ERROR: settings.json references missing local package: %s\n' "$src" >&2
      fail=1
    fi
  done < <(grep -oE '"\./packages/[^"]*"' "$ROOT/.pi/agent/settings.json" | tr -d '"')
fi

if [ "$fail" -ne 0 ]; then
  printf 'pi setup check failed\n' >&2
  exit 1
fi

printf 'pi setup check passed\n'
