#!/usr/bin/env bash
set -u
# Click behavior for the Mistral quota module:
# - toggle compact/expanded view
# - signal Waybar (RTMIN+10) to rerun the module immediately
dir="${XDG_CACHE_HOME:-$HOME/.cache}"
view="$dir/waybar-mistral-quota.view"
if [ "$(cat "$view" 2>/dev/null)" = "expanded" ]; then
  printf '%s' "compact" > "$view.tmp" && mv "$view.tmp" "$view"
else
  printf '%s' "expanded" > "$view.tmp" && mv "$view.tmp" "$view"
fi
pkill -RTMIN+10 waybar
