vim.o.number = true
vim.o.relativenumber = true
vim.o.expandtab = true
vim.o.tabstop = 2 --tab spacing
vim.o.signcolumn = 'yes'
vim.o.softtabstop = 2
vim.o.shiftwidth = 2
vim.o.swapfile = false
vim.g.mapleader = " "
vim.g.maplocalleader = "\\"
vim.o.winborder = 'rounded' -- round borders for popups
vim.o.conceallevel = 0
vim.o.undofile = true

vim.opt.ignorecase = true     -- search case insensitive
vim.opt.smartcase = true      -- search matters if capital letter
vim.opt.inccommand = "split"  -- "for incsearch while sub
vim.opt.splitbelow = true
vim.opt.splitright = true

local map = vim.keymap.set

vim.g.mapleader = " "
vim.g.maplocalleader = "\\"
map('n', '<leader>o', ':update<CR> :source<CR>')
map('n', '<leader>w', ':write<CR>')
map('n', '<leader>q', ':quit<CR>')
map('n', '<leader>Q', ':wqa<CR>')
map({'n', 'v', 'x'}, '<leader>y', '"+y<CR>')
map({'n', 'v', 'x'}, '<leader>d', '"+d<CR>')
map({'n', 'v', 'x'}, '<leader>s', ':e #<CR>')
map({'n', 'v', 'x'}, '<leader>y', '"+y')

map('n', '<leader>lf', vim.lsp.buf.format)
map('n', '<leader>m', ':nohlsearch<CR>')

--wl-clipboard
vim.g.clipboard = {
  name = 'wl-clipboard',
  copy = {
    ['+'] = 'wl-copy --foreground --type text/plain',
    ['*'] = 'wl-copy --foreground --primary --type text/plain',
  },
  paste = {
    ['+'] = 'wl-paste --no-newline',
    ['*'] = 'wl-paste --no-newline --primary',
  },
  cache_enabled = true,
}

--manual plugins

vim.cmd(":hi statusline guibg=NONE")
