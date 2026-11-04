# swaync example

`config.json` holds layout, timeouts, widgets and the control-centre buttons.
`style.css` is only the entry point: it imports the bar palette and the two
theme files.

```css
@import '../waybar-niri/colors.css';
@import 'themes/control_center.css';
@import 'themes/notifications.css';
```

Both theme files were written against a larger palette, so each defines the five
names the bar palette does not: `text`, `background-alt`, `selected`, `hover`,
`urgent`. They are repeated in both files so either can be imported alone.

No `icons/` or `images/` directory ships here: swaync takes notification images
from the icon theme and from the sender, and the buttons above are text. Add
`icons/` only if you reference it from CSS.
