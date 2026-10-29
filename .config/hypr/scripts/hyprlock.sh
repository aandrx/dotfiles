#!/bin/zsh
#hyprlock
WALL="$(awww query | grep -oP '(?<=image: ).*' | head -1)"
[ -n "$WALL" ] && ln -sf "$WALL" ~/.config/hypr/current_wallpaper
exec hyprlock
