return {
  {
    "williamboman/mason.nvim",
    config = function()
      require("mason").setup()
    end
  },
  {
    "williamboman/mason-lspconfig.nvim",
    config = function()
      require("mason-lspconfig").setup({
        ensure_installed = { "lua_ls", "ts_ls", "svelte", "cssls", "pylsp", "clangd" }
      })
    end
  },
  {
    "neovim/nvim-lspconfig",
    config = function()
      vim.lsp.config("lua_ls", {})
      vim.lsp.config("ts_ls", {})
      vim.lsp.config("svelte", {})
      vim.lsp.config("cssls", {})
      vim.lsp.config("pylsp", {})
      vim.lsp.config("clangd", {})
      vim.lsp.enable("html", {})
      vim.lsp.enable("markdown_oxide", {})
      vim.lsp.enable({"lua_ls", "ts_ls", "svelte", "cssls", "pylsp", "clangd", "html", "markdown_oxide"})

      vim.keymap.set('n', 'K', vim.lsp.buf.hover, {}) --shift+K
      vim.keymap.set('n', 'gd', vim.lsp.buf.definition, {}) --shift+gd
      vim.keymap.set({'n', 'v' }, '<leader>ca', vim.lsp.buf.code_action, {})
    end
  }
}

