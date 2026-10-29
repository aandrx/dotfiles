#!/usr/bin/env bash
set -u
# Click behavior for the Codex quota module (left and right click):
# - last poll failed (N/A showing): just refresh, keep the compact view
# - quota showing: toggle compact/expanded view, then refresh
dir="${XDG_CACHE_HOME:-$HOME/.cache}"
last="$dir/waybar-codex-quota.last"
view="$dir/waybar-codex-quota.view"
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
