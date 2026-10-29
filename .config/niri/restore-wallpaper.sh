#!/bin/sh
set -eu

wallpaper_file="$HOME/.config/waybar-niri/current_wallpaper"
sleep 2

if [ -r "$wallpaper_file" ]; then
    wallpaper=$(cat "$wallpaper_file")
    if [ -r "$wallpaper" ]; then
        awww img -n overview --resize crop --fill-color 5f5cd3ff \
            --transition-type none "$wallpaper"
        # Keep generated palettes in sync with the restored wallpaper.
        matugen image "$wallpaper" >/dev/null 2>&1 || true
        matugen image -m light -c "$HOME/.config/matugen/config-gtk.toml" "$wallpaper" >/dev/null 2>&1 || true
        exit 0
    fi
fi

awww restore -n overview
