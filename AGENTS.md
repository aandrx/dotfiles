# Public dotfiles: instructions for agents

Treat every tracked file, commit, tag, CI log, and attachment as public. Read
[PRIVACY.md](PRIVACY.md) before capturing or adding files. Privacy refusals
are blocking, not suggestions to bypass the scanner.

## Structure and ownership

- `.config/`, `.pi/`, `bin/`, and root shell files mirror the user's home.
- `scripts/`, `.github/`, `.githooks/`, and root documentation are repo-only.
- `*.example` files are documentation; do not deploy or capture them.
- `.pi/agent/packages/` contains maintained local packages, including patched
  `pi-context-bar` and `pi-split-view`. Preserve their local references in
  `settings.json`; replacing them with npm releases loses the patches.
- Ignored private files may still exist in a maintainer's checkout. They are
  not public input. Do not scan, archive, install, or publish the whole folder.
- Live files and the public configuration intentionally differ. Do not run an
  install into the maintainer's home, capture all live differences, or change
  live provider settings merely to make them match.

## Privacy requirements

1. Never open, print, copy, stage, or commit credential stores, private keys,
   cookies, provider model/auth files, MCP auth stores, sessions, logs, private
   plans, Wi-Fi profiles, or local environment files. Filename/permission
   metadata is enough to establish that an excluded file exists.
2. Keep names, personal emails, SSIDs/BSSIDs, internal addresses, SSH aliases,
   device identifiers, boot UUIDs, and private project notes machine-local.
   Use environment variables, application-supported home expansion, or clearly
   non-installable examples. Do not put real values in test fixtures.
3. New paths require explicit review. Do not use `git add .`, `git add -A`,
   bulk copies from home, or blanket capture commands. Inspect and stage the
   exact intended paths, then validate the index.
4. Use the shared privacy checker, not an ad hoc token regex. Extend tests and
   ignore rules alongside any new capture/deployment source. A mode of 600
   does not make committed content private.
5. Report potential secrets by path, line, and rule only. Never paste the
   value, a content-bearing diff, or an unredacted scanner report into chat,
   commit messages, issues, CI logs, or artifacts.
6. Do not suppress a finding globally or exclude vendor directories from
   scanning. Any exception must be narrow, demonstrably synthetic, documented,
   and reviewed.
7. Preserve third-party licenses and attribution. See [NOTICE.md](NOTICE.md).
   Never assign a blanket license to vendored files.

## Change and verification workflow

- Resolve the intended checkout with `git rev-parse --show-toplevel` and verify
  its identity before capture, installation, staging, commits, or pushes.
  Conventional `~/dotfiles` paths in deployment-oriented skills are not
  permission to operate on a different checkout. This clean snapshot must
  remain separate from the maintainer's private-history repository; never
  import that repository's branches, tags, or Git object database here.
- Start with `git status --short --branch`; preserve unrelated user work.
- Review selected live changes before `scripts/capture.sh`; stop on refusal.
- Run:

  ```sh
  python3 -m unittest discover -s scripts/tests -v
  python3 scripts/privacy-check.py
  scripts/check-pi-extension-imports.sh
  git diff --check
  ```

- Stage explicit paths, inspect the staged path list, then run:

  ```sh
  python3 scripts/privacy-check.py --staged
  gitleaks git --redact --log-opts=--all .
  ```

- Exercise installers only in a temporary HOME, with `--no-deps`. Dry-run
  must leave it untouched. Never test against the real home or credential
  stores.
- Commit, push, live deployment, root changes, history rewriting, and changing
  repository visibility are separate actions. Obtain authorization for the
  applicable action; cleanup alone is not permission to publish.

## Public release gate

Cleaning the tip does not clean history. Keep the repository private until
historical personal metadata, commit author identity, licenses, and all refs
have been reviewed. Prefer a separately approved sanitized snapshot over
rewriting the maintainer's private history. Do not claim a clean scanner run
proves the absence of every possible secret or privacy disclosure.
