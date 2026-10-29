return  {
  {
    'nvim-telescope/telescope.nvim', 
    tag = '0.1.8',
    dependencies = { 'nvim-lua/plenary.nvim' },
    config = function()
      local previewers = require("telescope.previewers")

      require("telescope").setup({
        defaults = {
          previewer = true,
          layout_strategy = "flex",
          preview_cutoff = 1
        }
      })

      local builtin = require("telescope.builtin")
      vim.keymap.set('n', '<leader>fg', builtin.live_grep, {})
      vim.keymap.set('n', '<C-p>', function()
        builtin.find_files({ hidden = true, cwd = vim.fn.expand("%:p:h") })
      end, {})
      vim.keymap.set('n', '<C-S-p>', function()
        vim.fn.inputsave()
        builtin.find_files({ hidden = true })
      end, {})
    end
  },
  {
    "nvim-telescope/telescope-ui-select.nvim",
    config = function()
      require("telescope").setup({ 
        extensions = {
          ["ui-select"] = {
            require("telescope.themes").get_dropdown {
            }
          }
        }
      })
      require("telescope").load_extension("ui-select")
    end
  },
}

