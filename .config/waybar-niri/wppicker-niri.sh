#!/bin/bash

# === CONFIG ===
WALLPAPER_DIR="$HOME/Pictures/wallpapers"
CURRENT_WALLPAPER_FILE="$HOME/.config/waybar-niri/current_wallpaper"
ROFI_WALLPAPER_LINK="$HOME/.config/rofi/current_wallpaper.png"

cd "$WALLPAPER_DIR" || exit 1

# === handle spaces in filenames
IFS=$'\n'

# === SELECT WALLPAPER WITH ROFI (uses the default config.rasi theme, same as the app switcher) ===
SELECTED_WALL=$(ls -t *.jpg *.png *.gif *.jpeg 2>/dev/null | rofi -dmenu -p "󰸉 Select Wallpaper")

[ -z "$SELECTED_WALL" ] && exit 1
SELECTED_PATH="$WALLPAPER_DIR/$SELECTED_WALL"

# === SET WALLPAPER WITH AWWW ===
# Single daemon drawn inside the backdrop; workspace backgrounds are transparent,
# so this one image is the master background everywhere (windows slide over it).
awww img -n overview --resize crop --fill-color 5f5cd3ff --transition-type any --transition-fps 60 "$SELECTED_PATH"

# === GENERATE COLORS WITH MATUGEN ===
matugen image "$SELECTED_PATH"

# GTK follows a light palette derived from the same wallpaper.
matugen image -m light -c "$HOME/.config/matugen/config-gtk.toml" "$SELECTED_PATH" \
    || notify-send -u normal "GTK palette" "matugen light pass failed"

# === SAVE CURRENT WALLPAPER ===
echo "$SELECTED_PATH" > "$CURRENT_WALLPAPER_FILE"
ln -sfn "$SELECTED_PATH" "$ROFI_WALLPAPER_LINK"

# === NOTIFICATION ===
notify-send "Wallpaper Changed" "New wallpaper and colorscheme applied" -i "$SELECTED_PATH"