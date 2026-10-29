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
alias bluetooth='rfkill unblock bluetooth; sudo systemctl start bluetooth; sleep 1; bluetoothctl power on 2>/dev/null; bluetoothctl show 2>/dev/null | grep -iE "Powered|Alias"'
alias bluetooth-off='sudo systemctl stop bluetooth; sudo systemctl disable bluetooth; rfkill block bluetooth; bluetoothctl power off 2>/dev/null; echo "bluetooth fully disabled"'


# ─── DeepSeek Harness ───
# dsh is installed globally at ~/.npm-global/bin/dsh; no alias needed.
