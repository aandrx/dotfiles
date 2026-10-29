# Waybar cleanup archive — 2026-10-24

Blocks removed from `style.css` and `config.jsonc` during the Batch 4 cleanup.

Everything here was one of:
- a selector for a module that is not present in `config.jsonc`,
- a rule fully overridden by a later rule of equal specificity,
- an option the module does not support.

Restore a block by pasting it back and reloading:

```
pkill -SIGUSR2 waybar
```

Full pre-cleanup copies also exist in
`~/rice-baseline-2026-10-23/.config/waybar-niri/`.
