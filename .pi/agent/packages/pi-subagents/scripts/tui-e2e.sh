#!/usr/bin/env bash
#
# tui-e2e.sh - drive the pi-subagents TUI in a real terminal and assert it.
#
# A model running inside a Pi session cannot press keys, so this script does it:
# it starts `pi` under a private tmux socket, drives `/agents -> Workflows`, and
# asserts the frames, footers and scroll view survive resizes. It exits non-zero
# on the first failed expectation.
#
#   bash scripts/tui-e2e.sh              # exercise the working tree (src/index.ts)
#   bash scripts/tui-e2e.sh --deployed   # exercise the deployed local package
#   bash scripts/tui-e2e.sh --keep       # leave the session up for debugging
#   bash scripts/tui-e2e.sh --verbose    # dump captured panes
#
set -euo pipefail

REPO="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MODE=local
KEEP=0
VERBOSE=0
while (($#)); do
  case "$1" in
    --deployed) MODE=deployed ;;
    --keep) KEEP=1 ;;
    --verbose) VERBOSE=1 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

for bin in pi tmux python3; do
  command -v "$bin" >/dev/null || { echo "ERROR: required binary not found: $bin" >&2; exit 1; }
done

SOCKET="pi-tui-e2e-$$"
TMP="$(mktemp -d)"
SESSION="pi-tui-e2e"
KEEP_ACTIVE=0
cleanup() {
  if ((KEEP_ACTIVE)); then
    echo "Kept tmux session '$SESSION' on socket $SOCKET (attach: tmux -L $SOCKET attach -t $SESSION)"
  else
    tmux -L "$SOCKET" kill-server >/dev/null 2>&1 || true
    # tmux leaves the socket file behind on this platform; remove it so a run
    # does not litter /tmp with one stale socket per invocation.
    rm -f "${TMPDIR:-/tmp}/tmux-$(id -u)/$SOCKET"
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

# Pi must not see a project to trust, and must not touch the real agent dir.
WORK="$TMP/work"
AGENTDIR="$TMP/agent"
mkdir -p "$WORK" "$AGENTDIR"
printf '{"workflowsEnabled": true}\n' > "$AGENTDIR/subagents.json"

FIXTURE="$TMP/workflow.js"
cat > "$FIXTURE" <<'JS'
export const meta = { name: 'tui-e2e', description: 'harness failure fixture', phases: [{ title: 'Fail' }] }
phase('Fail')
throw new Error('tui-e2e failure: ' + 'detail '.repeat(140))
JS

if [[ $MODE == deployed ]]; then
  ENTRY="$HOME/.pi/agent/packages/pi-subagents/pi-subagents/index.ts"
  [[ -f "$ENTRY" ]] || { echo "ERROR: deployed entry not found: $ENTRY" >&2; exit 1; }
else
  ENTRY="$REPO/src/index.ts"
fi

ROWS=()
FAILED=0
pass() { ROWS+=("PASS | $1"); }
nope() { ROWS+=("FAIL | $1 | $2"); FAILED=1; }

# Visible pane only. `-S -` would pull scrollback, where the previous (wider)
# render is still on record and every post-resize width check would fail.
capture() {
  tmux -L "$SOCKET" capture-pane -pt "$SESSION" \
    | perl -pe 's/\e\[[0-?]*[ -\/]*[@-~]//g' > "$TMP/pane"
}
# Poll for a pattern; bounded so a stuck start fails instead of hanging.
wait_for() {
  local pattern=$1 i
  for ((i = 0; i < 100; i++)); do
    capture
    grep -Eq "$pattern" "$TMP/pane" && return 0
    sleep 0.2
  done
  return 1
}
# A frame is "intact" when a top border and a lower bottom border are both
# present and no line is wider than the terminal. This deliberately does not
# assume the dialog is the pane's last line: pi always draws a status bar under
# it, which is what made the first version of this script always fail.
check_frame() {
  local width=$1 label=${2:-frame}
  python3 - "$TMP/pane" "$width" <<'PY'
import sys
lines = open(sys.argv[1], encoding="utf-8", errors="replace").read().splitlines()
width = int(sys.argv[2])
tops = [i for i, l in enumerate(lines) if "╭" in l and "╮" in l]
bottoms = [i for i, l in enumerate(lines) if "╰" in l and "╯" in l]
if not tops or not bottoms:
    raise SystemExit(f"missing frame border (tops={tops} bottoms={bottoms})")
if min(bottoms) <= max(tops):
    raise SystemExit("bottom border is not below the top border")
over = [(i, len(l)) for i, l in enumerate(lines) if len(l) > width]
if over:
    raise SystemExit(f"line wider than {width}: {over[:3]}")
PY
}

CMD=(pi -ne -e "$ENTRY" --no-session --subagents-workflow-file="$FIXTURE")
tmux -L "$SOCKET" new-session -d -s "$SESSION" -x 130 -y 42 \
  "cd '$WORK' && PI_CODING_AGENT_DIR='$AGENTDIR' HOME='$AGENTDIR' ${CMD[*]}" 2>"$TMP/tmux.err" \
  || { echo "ERROR: failed to start tmux: $(<"$TMP/tmux.err")" >&2; exit 1; }

if wait_for 'pi v[0-9]'; then pass 'startup main view'; else nope 'startup main view' 'banner timeout'; fi

# --- /agents menu ------------------------------------------------------------
tmux -L "$SOCKET" send-keys -t "$SESSION" '/agents' Enter
if wait_for 'Workflows \('; then pass '/agents menu lists Workflows'; else nope '/agents menu' 'missing Workflows entry'; fi
if check_frame 130; then pass 'menu frame'; else nope 'menu frame' 'no border'; fi

# Number of Down presses before "Workflows" is the selected row.
DOWNS=$(grep -n 'Workflows (' "$TMP/pane" | head -1 | cut -d: -f1 | awk -v first="$(grep -nE 'Agent types \(|Running agents \(' "$TMP/pane" | head -1 | cut -d: -f1)" '{print $1 - first}')
DOWNS=${DOWNS:-0}
for ((i = 0; i < DOWNS; i++)); do tmux -L "$SOCKET" send-keys -t "$SESSION" Down; sleep 0.05; done
tmux -L "$SOCKET" send-keys -t "$SESSION" Enter

if wait_for 'esc close'; then pass 'inspector opens'; else nope 'inspector opens' 'footer timeout'; fi
if grep -q 'tui-e2e' "$TMP/pane"; then pass 'inspector shows run name'; else nope 'inspector run name' 'missing'; fi
if grep -q 'e error' "$TMP/pane"; then pass 'inspector advertises e error'; else nope 'e error hint' 'missing'; fi
if check_frame 130; then pass 'inspector frame'; else nope 'inspector frame' 'no border'; fi

# --- resize invariants -------------------------------------------------------
# Pi redraws on SIGWINCH, which lands a moment after the resize; poll the
# invariant instead of assuming one sleep is enough, or stale wide lines from
# the previous size read as an overflow.
wait_frame() {
  local width=$1 i
  for ((i = 0; i < 30; i++)); do
    capture
    check_frame "$width" 2>/dev/null && return 0
    sleep 0.2
  done
  return 1
}
for size in '130 42' '62 24' '40 16' '40 8'; do
  read -r w h <<<"$size"
  tmux -L "$SOCKET" resize-window -t "$SESSION" -x "$w" -y "$h"
  if wait_frame "$w"; then
    pass "resize ${w}x${h} keeps frame"
  else
    reason=$(check_frame "$w" 2>&1 || true)
    nope "resize ${w}x${h}" "$reason"
  fi
done

# --- compact footer at a narrow width ---------------------------------------
tmux -L "$SOCKET" resize-window -t "$SESSION" -x 20 -y 30
sleep 0.3
capture
FOOTER=$(grep 'esc' "$TMP/pane" | tail -1 || true)
if [[ "$FOOTER" == *e* && "$FOOTER" == *esc* ]]; then
  pass '20-col footer keeps e and esc'
else
  nope '20-col footer' "expected e and esc, got: ${FOOTER:-<none>}"
fi

# --- expanded error view -----------------------------------------------------
tmux -L "$SOCKET" resize-window -t "$SESSION" -x 40 -y 16
sleep 0.3
tmux -L "$SOCKET" send-keys -t "$SESSION" e
if wait_for '[0-9]+-[0-9]+ of [0-9]+'; then pass 'expanded error scroll indicator'; else nope 'expanded error view' 'indicator timeout'; fi
if grep -q 'esc' "$TMP/pane"; then pass 'expanded error advertises esc'; else nope 'expanded error esc' 'missing'; fi
if check_frame 40; then pass 'expanded error frame'; else nope 'expanded error frame' 'no border'; fi

tmux -L "$SOCKET" send-keys -t "$SESSION" Escape
if wait_for 'esc close'; then pass 'Escape returns to inspector'; else nope 'Escape return' 'timeout'; fi

if ((VERBOSE)); then capture; echo '--- captured pane ---'; cat "$TMP/pane"; fi

printf '\n%-6s | %s\n' RESULT STEP
printf '%s\n' '-------+----------------------------------------'
for row in "${ROWS[@]}"; do printf '%s\n' "$row"; done
if ((FAILED)); then echo 'SUMMARY: FAIL'; exit 1; fi
echo 'SUMMARY: PASS'
if ((KEEP)); then KEEP_ACTIVE=1; fi
