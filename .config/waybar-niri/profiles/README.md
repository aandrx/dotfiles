# Profiles

A profile is a directory holding a complete waybar config and style:

```
profiles/
  status/
    config.jsonc
    style.css
  bottom/
    config.jsonc
    style.css
```

`status` is the default loaded by the top-level `config.jsonc`; `bottom` places
the same modules along the bottom edge. Each is self-contained, so either can
be launched directly.

Nothing is inherited, so each profile can differ freely: position, height,
module lists, styling. Shared pieces stay in one place and are reached with a
relative `@import` (or a relative symlink, `profiles/status/colors.css ->
../../colors.css`):

```css
/* profiles/status/style.css */
@import "../../colors.css";
```

Launch the bar with the profile you want:

```sh
waybar -c ~/.config/waybar-niri/profiles/status/config.jsonc \
       -s ~/.config/waybar-niri/profiles/status/style.css
```

To switch while it runs, point a `current` symlink at the profile and tell
waybar to reload; it re-reads config and CSS without restarting. Window
properties are re-applied too on waybar 0.15, so a top/bottom switch is a
reload, not a restart:

```sh
ln -sfn profiles/status ~/.config/waybar-niri/current
kill -USR2 "$(pgrep -x waybar)"
```

Adding a profile is a copy, an edit, and a repoint:

```sh
cp -a profiles/status profiles/compact
$EDITOR profiles/compact/config.jsonc     # change the module lists, or position
```

The top-level `config.jsonc` and `style.css` beside this directory include
`profiles/status`, so status is the default. Everything to read lives under
`profiles/`; launch `profiles/bottom` directly when you want the bottom layout.
