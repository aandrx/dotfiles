---
name: git-ops
description: Exclusively owns Git branches, commits, remotes, pushes, pulls, repository history, and SSH authentication for Git hosting. Do not add rue-mode or machine-maintenance unless local source code or an operating-system service must also change.
---

# Git operations

1. Inspect `git status --short --branch` before changing repository state.
2. Inspect only the needed history or remote metadata with `git log`, `git diff`, and `git remote -v`.
3. Preserve unrelated changes and stage explicit paths.
4. Use normal `git pull` and `git push`; GitHub SSH is already configured.
5. Never generate, replace, copy, or print credentials or SSH keys.
6. Stop before force-push, history rewriting, publishing, or destructive cleanup unless the user explicitly approved it. Missing Git-hosting authentication is not a reason to load machine-maintenance or replace credentials.
