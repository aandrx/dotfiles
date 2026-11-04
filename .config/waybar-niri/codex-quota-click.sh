#!/usr/bin/env bash
set -u
# Click behavior for the Codex quota module.
#
# Left/right click:
# - last poll failed (N/A showing): just refresh, keep the compact view
# - quota showing: toggle compact/expanded view (rendered from cache)
#
# Middle click:
# - force a fresh quota request, keeping the current view
dir="${XDG_CACHE_HOME:-$HOME/.cache}"
last="$dir/waybar-codex-quota.last"
view="$dir/waybar-codex-quota.view"
mode="${1:-toggle}"

if [ "$mode" = "refresh" ]; then
  rm -f "$dir/waybar-codex-quota.data"
  pkill -RTMIN+8 waybar
  exit 0
fi

if [ "$(cat "$last" 2>/dev/null)" = "ok" ]; then
  if [ "$(cat "$view" 2>/dev/null)" = "expanded" ]; then
    printf '%s' "compact" > "$view.tmp" && mv "$view.tmp" "$view"
  else
    printf '%s' "expanded" > "$view.tmp" && mv "$view.tmp" "$view"
  fi
else
  rm -f "$dir/waybar-codex-quota.data"
fi
pkill -RTMIN+8 waybar
