#!/usr/bin/env bash
# DeepSeek API peak-hours indicator for Waybar (niri).
#
# DeepSeek charges peak rates during 01:00-04:00 and 06:00-10:00 UTC,
# Monday-Friday. All other hours, all weekend, and Chinese public holidays
# are off-peak (off-peak rates are half of peak). Holidays are not modeled.
#
# Emits Waybar JSON: { "text": ..., "class": ..., "tooltip": ... }
#
# Self-contained: safe to delete along with the matching entries in
# config.jsonc / style.css to remove the module.

set -euo pipefail

# --- tweakables ---------------------------------------------------------
TIMER_ICON=$'\U000F13AB'      # nf-md-timer (shown in the click/alt view)
# Peak windows in UTC hours, end-exclusive: "start-end"
# Chinese public holidays are also off-peak per DeepSeek's docs, but are not
# modeled here. The tooltip states this limitation.
PEAK_WINDOWS=("1-4" "6-10")
# ------------------------------------------------------------------------

# Remember the caller's timezone so the tooltip can show local times.
orig_tz_set=0
if [ "${TZ+x}" = x ]; then orig_tz_set=1; orig_tz="$TZ"; fi

# Do all peak-window math in UTC. bash's printf %T honours $TZ.
export TZ=UTC0

# is_peak_at <epoch> -> echoes 1 (peak) or 0 (off-peak)
is_peak_at() {
  local t=$1 hh dow w s e
  printf -v hh  '%(%H)T' "$t"
  printf -v dow '%(%u)T' "$t"          # 1=Mon .. 7=Sun
  hh=$((10#$hh)); dow=$((10#$dow))
  [ "$dow" -le 5 ] || { echo 0; return; }
  for w in "${PEAK_WINDOWS[@]}"; do
    s=${w%-*}; e=${w#*-}
    if [ "$hh" -ge "$s" ] && [ "$hh" -lt "$e" ]; then echo 1; return; fi
  done
  echo 0
}

now=$(date -u +%s)
# Test hook: set DS_PEAK_EPOCH to an epoch to evaluate that instant.
if [ -n "${DS_PEAK_EPOCH:-}" ]; then now="$DS_PEAK_EPOCH"; fi
cur=$(is_peak_at "$now")

# Find the next transition by scanning forward one hour at a time
# (printf %T is a builtin, so this is a cheap pure-shell loop).
next=$(( (now / 3600 + 1) * 3600 ))
for ((i = 0; i < 200; i++)); do
  [ "$(is_peak_at "$next")" != "$cur" ] && break
  next=$(( next + 3600 ))
done

# --- labels -------------------------------------------------------------
if [ "$cur" -eq 1 ]; then
  text="PEAK"
  class="peak"
  state="PEAK (full price)"
  rates='in $0.30  out $1.20  cache $0.006'
  next_label="OFF-PEAK"
else
  text="OFF-PEAK"
  class="offpeak"
  state="OFF-PEAK (half price)"
  rates='in $0.15  out $0.60  cache $0.003'
  next_label="PEAK"
fi

# --- "next change in ..." ----------------------------------------------
rem=$(( next - now ))
if [ "$rem" -lt 0 ]; then rem=0; fi
days=$(( rem / 86400 ))
hrs=$(( (rem % 86400) / 3600 ))
mins=$(( (rem % 3600) / 60 ))
if   [ "$days" -gt 0 ]; then dur="${days}d ${hrs}h"
elif [ "$hrs"  -gt 0 ]; then dur="${hrs}h ${mins}m"
elif [ "$mins" -gt 0 ]; then dur="${mins}m"
else                          dur="<1m"
fi

# Alternate (click) view: countdown until the next rate change.
alt_text="${TIMER_ICON} ${dur} → ${next_label}"

# Restore the caller's timezone before rendering local times.
if [ "$orig_tz_set" -eq 1 ]; then export TZ="$orig_tz"; else unset TZ; fi
printf -v next_local '%(%a %H:%M)T' "$next"
tz=$(date +%Z)
next_utc=$(TZ=UTC0 date -d "@$next" +'%a %H:%M')

tooltip="<b>DeepSeek V4.1-Flash</b>  -  ${state}
Next  ${next_label} in ${dur}  (${next_local} ${tz} / ${next_utc} UTC)
Peak  Mon-Fri 01:00-04:00 + 06:00-10:00 UTC (CN holidays not modeled)
Rates per 1M tokens  ${rates}"

# --- JSON out -----------------------------------------------------------
json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  printf '%s' "$s"
}
printf '{"text":"%s","alt":"%s","class":"%s","tooltip":"%s"}\n' \
  "$(json_escape "$text")" "$(json_escape "$alt_text")" "$class" "$(json_escape "$tooltip")"
