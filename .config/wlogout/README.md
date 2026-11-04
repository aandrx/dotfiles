# wlogout example

`layout` holds one JSON object per button: `label` (also the CSS id), `action`,
`text` and `keybind`. Icons are not named in the layout; the stylesheet paints
them:

```css
#lock { background-image: image(url("./icons/lock.png")); }
```

Drop the `background-image` rules, or the whole `icons/` directory, and the
buttons render as text only. That is enough for a working logout menu, and it is
why only the six icons the stylesheet references are kept here.

`style.css` imports the bar's palette from `../waybar-niri/colors.css`, so the
menu follows the same colours as the rest of the desktop.
