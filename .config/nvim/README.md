# nvim example

`init.lua` bootstraps lazy.nvim and loads the modules:

- `lua/vim-options.lua`: plain editor options
- `lua/lsp.lua`: completion on attach plus `vim.lsp.config` server settings
- `lua/plugins.lua` and `lua/plugins/*.lua`: one file per plugin spec

No `lazy-lock.json` ships here: lazy.nvim writes it on first install and it
pins commits that are specific to the machine and the day. Generate your own by
running `:Lazy sync`.

`lua/plugins/lsp-config.lua` defines the same servers that `lua/lsp.lua`
enables; add or remove them together.
