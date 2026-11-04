# cava example

Only the settings that actually differ from cava's defaults are kept:

- `[input] method = pipewire`, `source = auto` — follow the default sink
- `[color] gradient = 1` with two colours

`[general]`, `[output]` and `[smoothing]` are present but empty, which is a
reminder that cava's defaults apply. Add keys there for bars, framerate,
smoothing and so on.

On the author's machine matugen rewrites the `[color]` block from the wallpaper
(`[templates.cava]` in `../matugen/config.toml`), so the live `config` is a
generated file; this copy is a hand-written sample. No shaders or themes ship:
the upstream `shaders/` set is only used when `vertex_shader` /
`fragment_shader` are set in the config, and theme files are only read when the
config points at one.
