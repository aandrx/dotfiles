# Split waybar example

`config` and `style.css` are symlinks into `configs/` and `style/`. Switching a
layout or a look is one `ln -sfn`, nothing is edited or copied:

```sh
ln -sfn configs/default config
ln -sfn style/default.css style.css
```

`configs/default` includes `../Modules`, a fragment holding the module
definitions, so each layout stays short and modules live in one place.
`style/default.css` imports `../colors.css`, the palette (in the author's setup
matugen writes that file from the current wallpaper).

Add a layout by copying `configs/default`, changing the module lists, and
pointing the symlink at it:

```sh
cp configs/default configs/compact
$EDITOR configs/compact
ln -sfn configs/compact config
```

Restart or reload waybar after a switch (`kill -SIGUSR2 $(pgrep -x waybar)`).
