# matugen example

matugen renders templates with colours taken from the wallpaper. `config.toml`
maps each template to one output file:

```toml
[templates.waybar-niri]
input_path = '~/.config/matugen/templates/waybar-niri-colors.css'
output_path = '~/.config/waybar-niri/colors.css'
post_hook = 'pkill -SIGUSR2 waybar 2>/dev/null || true'
```

Three templates show the shapes involved:

- `templates/colors.css`: the generic form, a loop over every Material colour role
- `templates/waybar-niri-colors.css`: the handful of names the bar actually uses
- `templates/kitty-colors.conf`: the same idea for a non-CSS format

Add one `[templates.<name>]` block per file you want generated, and use
`post_hook` for the reload that makes the application read it. Outputs are
generated artifacts; keep them out of version control.
