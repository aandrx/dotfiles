return  {
  "nvim-neo-tree/neo-tree.nvim",
  branch = "v3.x",
  dependencies = {
    "nvim-lua/plenary.nvim",
    "MunifTanjim/nui.nvim",
    "nvim-tree/nvim-web-devicons",
  },
  lazy = false,
  config = function()
    require("neo-tree").setup({
      filesystem = {
        filtered_items = {
          hide_dotfiles = false,
          hide_gitignored = false,
        },
      },
      window = {
        width = 25,
        position = "left",
        adaptive_size = true,
        number = false,
        relativenumber = false,
      },
      default_component_configs = {
        indent = {
          padding = 0,
        },
      },
    })
    vim.keymap.set('n', '<leader>b', ':Neotree toggle filesystem reveal left<CR>', {})
    vim.keymap.set('n', '<leader>n', ':Neotree action=focus<CR>', {})
  end
}
