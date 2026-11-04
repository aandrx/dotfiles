# If you come from bash you might have to change your $PATH.
# export PATH=$HOME/bin:$HOME/.local/bin:/usr/local/bin:$PATH

# Path to your Oh My Zsh installation.
export ZSH="$HOME/.oh-my-zsh"

# See https://github.com/ohmyzsh/ohmyzsh/wiki/Themes
ZSH_THEME="robbyrussell"

# Uncomment the following line to use case-sensitive completion.
# CASE_SENSITIVE="true"

# zstyle ':omz:update' mode disabled  # disable automatic updates
# zstyle ':omz:update' mode auto      # update automatically without asking
# zstyle ':omz:update' mode reminder  # just remind me to update when it's time

# Uncomment the following line if pasting URLs and other text is messed up.
# DISABLE_MAGIC_FUNCTIONS="true"

# Uncomment the following line to enable command auto-correction.
# ENABLE_CORRECTION="true"

# Uncomment the following line to display red dots whilst waiting for completion.
# You can also set it to another string to have that shown instead of the default red dots.
# e.g. COMPLETION_WAITING_DOTS="%F{yellow}waiting...%f"
# Caution: this setting can cause issues with multiline prompts in zsh < 5.7.1 (see #5765)
# COMPLETION_WAITING_DOTS="true"

# Uncomment the following line if you want to disable marking untracked files
# under VCS as dirty. This makes repository status check for large repositories
# much, much faster.
# DISABLE_UNTRACKED_FILES_DIRTY="true"

# Uncomment the following line if you want to change the command execution time
# stamp shown in the history command output.
# You can set one of the optional three formats:
# "mm/dd/yyyy"|"dd.mm.yyyy"|"yyyy-mm-dd"
# or set a custom format using the strftime function format specifications,
# see 'man strftime' for details.
# HIST_STAMPS="mm/dd/yyyy"

# Would you like to use another custom folder than $ZSH/custom?
# ZSH_CUSTOM=/path/to/new-custom-folder

# Which plugins would you like to load?
# Standard plugins can be found in $ZSH/plugins/
# Custom plugins may be added to $ZSH_CUSTOM/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
plugins=(
	git
	zsh-autosuggestions
	zsh-syntax-highlighting
)

# rust/rustup and Go paths must be defined before PATH expansion.
export GOPATH=$HOME/go

# Path configuration
export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:$PATH"
export PATH="$PATH:/usr/local/go/bin:$GOPATH/bin"
export PATH="$HOME/.opencode/bin:$PATH"
typeset -U PATH

# plugin edit
ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE='fg=6'

source $ZSH/oh-my-zsh.sh

# User configuration

# export MANPATH="/usr/local/man:$MANPATH"

export LANG=en_US.UTF-8

# Preferred editor for local and remote sessions if [[ -n $SSH_CONNECTION ]]; then
#   export EDITOR='vim'
# else
#   export EDITOR='nvim'
# fi

# Compilation flags
# export ARCHFLAGS="-arch $(uname -m)"

# Set personal aliases, overriding those provided by Oh My Zsh libs,
# plugins, and themes. Aliases can be placed here, though Oh My Zsh
# users are encouraged to define aliases within a top-level file in
# the $ZSH_CUSTOM folder, with .zsh extension. Examples:
# - $ZSH_CUSTOM/aliases.zsh
# - $ZSH_CUSTOM/macos.zsh
# For a full list of active aliases, run `alias`.

alias zshconfig="mate ~/.zshrc"
alias ohmyzsh="mate ~/.oh-my-zsh"

fastfetch
#export PATH=$HOME/bin:$HOME/.local/bin:$PATH

# gnome-keyring
export GNOME_KEYRING_CONTROL="$XDG_RUNTIME_DIR/keyring"
export SSH_AUTH_SOCK="$XDG_RUNTIME_DIR/keyring/ssh"

# rust/rustup
source "$HOME/.cargo/env"
#export PATH=$PATH:/usr/local/go/bin
#export PATH=$PATH:$GOPATH/bin
export GO111MODULE=on

export GPG_TTY=$(tty)

# wayland in conda
export MPLBACKEND=Agg
export QT_QPA_PLATFORM=xcb

# fastfetch
alias fast='fastfetch'

# nmtui color config
alias nmtui='NEWT_COLORS=$(<~/.config/nmtui/palette) nmtui'

# discordo
alias discordo="~/Documents/Apps/discordo/./discordo"

# kdenlive 
alias kden="~/Documents/Apps/Kdenlive/./kdenlive-25.12.1-x86_64.AppImage"

# circuitsim
alias csim="cd ~/Documents/CS2110 && java -jar CircuitSim.jar &; cd ~"

# lc3tools
alias lc3tools="cd ~/Documents/CS2110 && flatpak run --socket=wayland io.github.gt_cs2110.lc3tools; cd ~"

# inkscape
alias inkscape="~/Documents/LMC3402/./Inkscape-0d15f75-x86_64.AppImage"

# processing 
alias processing="~/Documents/LMC3402/processing-4.5.2-linux-x64-portable/Processing/bin/./Processing; cd ~"

# llama.cpp local server (model id 'local-model' expected by pi's qwen-local provider)
alias llama-start='~/Documents/Apps/llama.cpp/start-server.sh'
alias llama-stop='pkill -f "llama-server.*Qwen3.6" && echo stopped || echo not running'
alias llama-log='tail -f /tmp/llama-server.log'

# lunar 
alias lunarclient="~/.lunar/./Lunar\ Client-3.7.12-ow.AppImage --enable-features=UseOzonePlatform --enable-unsafe-swiftshader --ozone-platform=x11"

# pokemmo is a script at ~/.local/bin/pokemmo so niri/rofi can launch it too

# opencode
alias oc="opencode"

# missioncenter
alias mc="missioncenter"

# openbubbles (flatpak GUI)
alias ob="setsid -f flatpak run app.openbubbles.OpenBubbles >/dev/null 2>&1"
# closing the window only hides it; notifications keep arriving, so this stops it fully
alias obk='flatpak kill app.openbubbles.OpenBubbles 2>/dev/null || echo "OpenBubbles not running"'

# >>> conda initialize >>>
# !! Contents within this block are managed by 'conda init' !!
__conda_setup="$("$HOME/miniconda3/bin/conda" 'shell.zsh' 'hook' 2> /dev/null)"
if [ $? -eq 0 ]; then
    eval "$__conda_setup"
else
    if [ -f "$HOME/miniconda3/etc/profile.d/conda.sh" ]; then
        . "$HOME/miniconda3/etc/profile.d/conda.sh"
    else
        export PATH="$HOME/miniconda3/bin:$PATH"
    fi
fi
unset __conda_setup
# <<< conda initialize <<<



# ─── Bluetooth on-demand (autostart removed) ───
alias bt='rfkill unblock bluetooth; sudo systemctl start bluetooth; sleep 1; bluetoothctl power on 2>/dev/null; bluetoothctl show 2>/dev/null | grep -iE "Powered|Alias"'
alias bt-off='sudo systemctl stop bluetooth; sudo systemctl disable bluetooth; rfkill block bluetooth; bluetoothctl power off 2>/dev/null; echo "bluetooth fully disabled"'

# btm: start bluetooth, resolve the mouse by name, connect. No interactive bluetoothctl.
# Internal: service, uhid and adapter power for the bluetooth helpers.
_bt_svc() {
  rfkill unblock bluetooth >/dev/null 2>&1
  if ! systemctl is-active --quiet bluetooth; then
    sudo systemctl start bluetooth || return 1
    sleep 1
  fi
  if ! grep -q '^uhid ' /proc/modules; then
    echo "loading uhid (required for BLE HID input)..."
    sudo modprobe uhid || return 1
    sudo systemctl restart bluetooth || return 1
    sleep 1
  fi
  bluetoothctl show 2>/dev/null | grep -q 'Powered: yes' ||
    bluetoothctl power on >/dev/null 2>&1
}

# Internal: every cached MAC whose name looks like the mouse.
_bt_macs() {
  bluetoothctl devices 2>/dev/null |
    awk '/^Device/ && tolower($0) ~ /m240|logitech|mouse/ {print $2}'
}

# Internal: MACs currently advertising. $1 = seconds.
_bt_scan() {
  timeout $(( $1 + 7 )) bluetoothctl --timeout "$1" scan on 2>&1 |
    grep -oE '([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}' | tr 'A-F' 'a-f' | sort -u
}

# Internal: cached MACs that hold a real bond.
_bt_bonded_macs() {
  local m
  for m in ${(f)"$(_bt_macs)"}; do
    [[ -z $m ]] && continue
    bluetoothctl info "$m" 2>/dev/null | grep -q 'Bonded: yes' && echo "$m"
  done
}

# Internal: interactive bluetoothctl session with a NoInputNoOutput agent.
# The capability must come from --agent at startup: the agent is registered
# before any command runs, and a mouse cannot confirm a numeric comparison.
_bt_session() {
  local mac=$1 action=$2 wait=${3:-10}
  {
    printf 'default-agent\n'
    if [[ $action == pair ]]; then
      printf 'pair %s\ntrust %s\n' "$mac" "$mac"
    else
      printf 'trust %s\nconnect %s\n' "$mac" "$mac"
    fi
    sleep "$wait"
    printf 'quit\n'
  } | timeout $(( wait + 40 )) stdbuf -oL -eL bluetoothctl --agent NoInputNoOutput 2>&1
}

# Internal: command reference, printed by `btm --help`.
_bt_help() {
  cat <<'EOF'
Bluetooth helpers for the Logitech M240 work mouse (on-demand, nothing at boot)

  btm                Reconnect the bonded mouse. Fast when it is awake; prints
                     the device state and HID input device when done.
  btm --help         This text.
  bt                 Start bluetoothd, power the adapter, show adapter state.
  bt-off             Stop bluetoothd, disable it at boot, rfkill-block the radio.
  btm-pair           Guided re-pair: hold the mouse button ~3s until the LED
                     blinks fast, press Enter. Scans 6s, pairs with a
                     NoInputNoOutput agent, prints bonded state.
  btm-pair --trace   Same, plus an HCI/SMP trace on failure.
  bt-status          Device state, HID input device, stored bond keys (IRK/LTK).
  bt-diag            Bond keys plus an HCI trace of one connect attempt.

Notes
  Bluetooth is disabled at boot. After a reboot, run btm once; after that the
  bonded mouse reconnects by itself, including across its own power cycles.
  A sleeping BLE mouse does not advertise, so btm cannot force a connection.
  Move the mouse and BlueZ connects it from the kernel accept list.
  "Failed to connect: InProgress" means that automatic reconnect is already
  running; it is not an error to fix.
EOF
}

btm() {
  local mac bonded='' i

  case $1 in
    --help|-h|help)
      _bt_help
      return 0
      ;;
  esac

  _bt_svc || return 1

  bonded=$(_bt_bonded_macs | head -1)
  if [[ -z $bonded ]]; then
    echo "No bonded mouse entry. Run btm-pair once, then use btm."
    return 1
  fi

  # A bonded device sits in the kernel accept list, so BlueZ connects by
  # itself once the mouse advertises. A sleeping BLE mouse never answers a
  # manual connect request, and racing it only produces InProgress.
  if ! bluetoothctl info "$bonded" 2>/dev/null | grep -q 'Connected: yes'; then
    echo "wake the mouse (move it)..."
    for i in {1..10}; do
      bluetoothctl info "$bonded" 2>/dev/null | grep -q 'Connected: yes' && break
      sleep 0.5
    done
  fi

  bluetoothctl info "$bonded" 2>/dev/null |
    grep -E '^[[:space:]]*(Name|Paired|Bonded|Trusted|Connected):'

  if ls /sys/bus/hid/devices/ 2>/dev/null | grep -qi '046D'; then
    echo "HID input device present"
  else
    echo "no HID input device yet (move the mouse to wake it)"
  fi
}

# btm-pair: clean re-pair against whatever address the mouse is on air with.
# btm-pair --trace additionally records an HCI trace for troubleshooting.
btm-pair() {
  local mac seen bonded='' candidates=() trace=/tmp/btm-pair.snoop do_trace=0
  [[ $1 == --trace ]] && do_trace=1

  # Restarting bluetoothd drops the working bond and costs seconds, so only
  # do it when uhid was missing (HOG would otherwise stay disabled).
  _bt_svc || return 1

  echo "Hold the M240 button ~3s until the LED blinks fast, then press Enter."
  read -r

  echo "scanning 6s..."
  seen=$(_bt_scan 6)

  for mac in ${(f)"$(_bt_macs)"}; do
    [[ -z $mac ]] && continue
    [[ $seen == *${mac:l}* ]] && candidates+=("$mac")
  done

  if (( ${#candidates} == 0 )); then
    echo "No mouse advertising. Hold the button ~3s (fast blink) and rerun."
    return 1
  fi

  # Remove non-live entries: bluetoothctl remove also clears the kernel
  # accept list entry, and a stale one blocks the new connection.
  for mac in ${(f)"$(_bt_macs)"}; do
    [[ -z $mac ]] && continue
    [[ " ${candidates[*]} " == *" $mac "* ]] && continue
    bluetoothctl remove "$mac" >/dev/null 2>&1 &&
      echo "removed stale $mac (cleared accept list)"
  done

  if (( do_trace )); then
    sudo timeout 90 btmon -w "$trace" >/dev/null 2>&1 &
    sleep 0.5
  fi

  for mac in "${candidates[@]}"; do
    echo "pairing with $mac"
    _bt_session "$mac" pair 3 |
      sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' -e 's/^\[[^]]*\][> ]*//' |
      grep -v '^$' | tail -5
    # The bond property lags the pair reply, so poll instead of sleeping flat.
    local tries=0
    while (( tries < 16 )); do
      bluetoothctl info "$mac" 2>/dev/null | grep -q 'Bonded: yes' &&
        { bonded=$mac; break }
      sleep 0.5
      (( tries++ ))
    done
    [[ -n $bonded ]] && break
  done

  if (( do_trace )); then
    sudo pkill -f "btmon -w $trace" 2>/dev/null
  fi

  if [[ -z $bonded ]]; then
    echo "pairing failed"
    if (( do_trace )); then
      echo "hci/smp summary:"
      timeout 20 btmon -r "$trace" 2>/dev/null |
        grep -iE 'smp|pairing|advertising report|le create|status: 0x0[1-9a-f]|failed|reason' |
        tail -20
    else
      echo "rerun with: btm-pair --trace"
    fi
    return 1
  fi

  echo "bonded: $bonded"
  bluetoothctl info "$bonded" 2>/dev/null |
    grep -E '^[[:space:]]*(Name|Paired|Bonded|Trusted|Connected):'

  if ls /sys/bus/hid/devices/ 2>/dev/null | grep -qi '046D'; then
    echo "HID input device present"
  else
    echo "no HID input device yet (move the mouse to wake it)"
  fi
}

# bt-status: what the mouse link looks like right now, including stored keys.
bt-status() {
  local m f
  for m in ${(f)"$(_bt_macs)"}; do
    [[ -z $m ]] && continue
    echo "== $m"
    bluetoothctl info "$m" 2>/dev/null |
      grep -E '^[[:space:]]*(Name|Paired|Bonded|Trusted|Connected|WakeAllowed|Battery Percentage):'
  done

  if ls /sys/bus/hid/devices/ 2>/dev/null | grep -qi '046D'; then
    echo "HID: $(ls /sys/bus/hid/devices/ | grep -i 046D)"
  else
    echo "HID: none"
  fi

  for f in /sys/class/input/input*/name; do
    [[ $(cat "$f" 2>/dev/null) == *M240* ]] && echo "input: $(cat "$f")"
  done

  echo "== stored bond keys"
  sudo sh -c 'grep -H -E "^\[(IdentityResolvingKey|PeripheralLongTermKey|SlaveLongTermKey)\]" /var/lib/bluetooth/*/DD:8D:B1:3A:51:*/info 2>/dev/null || echo "none"'
}

# bt-diag: bond keys and an HCI-level trace of one connect attempt.
bt-diag() {
  local mac
  mac=$(_bt_macs | head -1)
  [[ -n $mac ]] || { echo "no cached mouse entry"; return 1; }
  sudo sh -c '
    echo "=== bond info for $1 ==="
    for f in /var/lib/bluetooth/*/$1/info; do
      [ -f "$f" ] && cat "$f"
    done
    echo "=== connect attempt with hci trace ==="
    timeout 40 btmon -w /tmp/bt.snoop >/dev/null 2>&1 &
    sleep 1
    { printf "agent NoInputNoOutput\ndefault-agent\nconnect %s\n" "$1"; sleep 10; printf "quit\n"; } |
      timeout 45 bluetoothctl 2>&1 | grep -E "successful|Failed|Bonded:|Connected:" | tail -3
    bluetoothctl info "$1" | grep -E "Paired|Bonded|Trusted|Connected"
    wait
    echo "=== hci errors ==="
    btmon -r /tmp/bt.snoop 2>/dev/null | grep -iE "status|error|fail|timeout|disconn" | tail -25
  ' sh "$mac" 2>&1 | tee /tmp/bt-diag.txt
}


# ─── DeepSeek Harness ───
# dsh is installed globally at ~/.npm-global/bin/dsh; no alias needed.

# Machine-local overrides (never tracked).
[ -f "$HOME/.zshrc.local" ] && . "$HOME/.zshrc.local"
