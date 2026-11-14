#!/usr/bin/env bash
set -u
# Click behavior for the Claude quota module:
# - toggle compact/expanded view
# - signal Waybar (RTMIN+11) to rerun the module immediately
dir="${XDG_CACHE_HOME:-$HOME/.cache}"
view="$dir/waybar-claude-quota.view"
if [ "$(cat "$view" 2>/dev/null)" = "expanded" ]; then
  printf '%s' "compact" > "$view.tmp" && mv "$view.tmp" "$view"
else
  printf '%s' "expanded" > "$view.tmp" && mv "$view.tmp" "$view"
fi
pkill -RTMIN+11 waybar
