# web search / fetch

- Search priority: Ollama -> SearXNG -> Tavily -> Exa
- Fetch priority: Ollama -> Tavily -> ruepi extractor -> Exa

These are priorities for choosing a tool, not automatic fallback. Move to the next provider yourself when a call fails or returns nothing. `TAVILY_API_KEY` is read from the environment at startup. `SEARXNG_URL` defaults to `http://localhost:8888`, and `SELFHOSTED_EXTRACT_URL` defaults to `http://localhost:8899`; point them at your own services. `EXA_API_KEY` is optional. `ruepi_web_extract` handles static HTML and text PDFs only; report an unhelpful shell rather than claiming content you did not retrieve.

# secrets

Never commit or print credential material: ~/.git-credentials, ~/.pi/agent/auth.json, ~/.pi/agent/models.json, ~/.pi/agent/models-store.json, ~/.password-store, ~/.ssh, *.pem, cookies.

# dotfiles

Portable dotfiles live at ~/dotfiles as a plain tree that mirrors ~ (no chezmoi). Read the repository `AGENTS.md` and `PRIVACY.md` first. Deploy with ~/dotfiles/scripts/install.sh; capture only reviewed, public-safe files with ~/dotfiles/scripts/capture.sh. Never capture live drift, private notes, or credentials. Linux-only WM and Wayland configs are skipped on other systems. /skill:dotfiles-sync is explicit-invocation only.
