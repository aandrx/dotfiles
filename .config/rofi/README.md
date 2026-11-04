# rofi example

`config.rasi` is the whole look: `@theme "/dev/null"` drops rofi's default
theme, `@import "colors.rasi"` pulls in the palette, then the widgets are styled
explicitly.

`colors.rasi` is a sample with only the names this theme uses. On the author's
machine matugen generates it from the wallpaper (`[templates.rofi]` in
`../matugen/config.toml`), so the real file must not be edited by hand and
should not be tracked.

The `imagebox` wallpaper behind the input bar is commented out: it reads a
runtime symlink (`current_wallpaper.png`) that is not part of this repository.
Point it at any image, or keep the solid background.
