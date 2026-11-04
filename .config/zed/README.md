# zed example

`settings.json` is a trimmed set of what the author changes: panel docks, fonts,
the terminal shell, theme and icons, and telemetry off. Values that are personal
to a machine are left out on purpose — in particular `ssh_connections`, which
holds host aliases.

`keymap.json` keeps one context block with the bindings actually used plus a few
commented examples. Zed merges this over its default keymap; `"key": null`
removes a default binding.

Docs: https://zed.dev/docs/configuring-zed and
https://zed.dev/docs/key-bindings
