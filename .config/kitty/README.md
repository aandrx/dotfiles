# kitty example

`kitty.conf` is the whole terminal config: font, opacity, scrolling, shell and
padding, ending with `include colors.conf` so the palette lives on its own.

`colors.conf` is a sample palette with the standard key names. On the author's
machine matugen generates it from the wallpaper (`[templates.kitty]` in
`../matugen/config.toml`, with a `post_hook` that signals kitty), so the real
file should not be edited by hand and should not be tracked.

Docs: https://sw.kovidgoyal.net/kitty/conf/
