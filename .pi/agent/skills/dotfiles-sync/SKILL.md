---
name: dotfiles-sync
description: Review and capture selected public-safe dotfiles into ~/dotfiles, then commit or push only when explicitly requested.
disable-model-invocation: true
---

# Dotfiles sync

Run only when explicitly invoked. Read `~/dotfiles/AGENTS.md` and
`~/dotfiles/PRIVACY.md` first. The repository uses plain filenames, no chezmoi.
Private local settings are deliberately not identical to the public tree.

## 1. Inspect without exposing private content

```sh
git -C ~/dotfiles status --short --branch
~/dotfiles/scripts/capture.sh --dry-run
```

Report drift using paths only. New paths, deletions, and examples require
separate review; never blindly capture all differences or print a raw diff
of credentials, private notes, or network configuration.

## 2. Capture only the requested, reviewed paths

```sh
cd ~/dotfiles
./scripts/capture.sh --dry-run <reviewed-tracked-path>
./scripts/capture.sh <reviewed-tracked-path>
```

Privacy refusals are blocking. Do not bypass checks, weaken rules, or replace
portable examples with live identifiers. Never read or copy credential stores,
provider model files, sessions, private plans, or ignored local files.

## 3. Validate and stage explicitly

```sh
python3 -m unittest discover -s scripts/tests -v
python3 scripts/privacy-check.py
./scripts/check-pi-extension-imports.sh
git diff --check
git add -- <reviewed-path>
python3 scripts/privacy-check.py --staged
gitleaks git --redact --log-opts=--all .
```

Do not use `git add -A`, `git add .`, or indiscriminate `git add -u`.
Scanner failures must be resolved, not suppressed. Findings are reported only
as path, line, and rule, without secret values or private excerpts.

## 4. Commit/push only within explicit authorization

Do not deploy to the live home or `/etc` as part of capture. Do not publish,
change visibility, force-push, or rewrite history. These need separate approval.
Never append an agent co-author line to a commit message.

## 5. Report actual outcomes

State the reviewed paths, verification performed, remaining live/repo drift,
and whether changes are staged, committed, pushed, or only prepared. Do not
claim a clean Git status proves that the live system is fully reproduced or
that existing history is safe to publish.
