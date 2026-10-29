#
# ~/.bashrc
#

# If not running interactively, don't do anything
[[ $- != *i* ]] && return

alias ls='ls --color=auto'
alias grep='grep --color=auto'
PS1='[\u@\h \W]\$ '

#bash completion 
if [ -f /usr/share/bash-completion/bash_completion ]; then
	. /usr/share/bash-completion/bash_completion
fi
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
export PATH=$PATH:/usr/local/go/bin
export GOPATH=$HOME/go
export PATH=$PATH:$GOPATH/bin
export GO111MODULE=on

# Machine-local overrides (never tracked). Put host-specific PATH entries,
# provider keys, and tool shims here so install.sh can overwrite this file.
[ -f "$HOME/.bashrc.local" ] && . "$HOME/.bashrc.local"
