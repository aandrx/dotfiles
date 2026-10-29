# Privacy policy and public-release checklist

## What belongs here

Portable configuration, maintained extension/skill source, public examples,
static theme assets, and repository tooling. Local patched packages belong in
`.pi/agent/packages/`; their dependency directories do not.

This is not a backup of a home directory or an operating-system image.

## What stays local

- Provider authentication, model credential configuration, API keys, registry
  tokens, passwords, private keys, SSH configuration, cookies, and certificates
  containing private material.
- Pi sessions, cached responses, spill, checkpoints, trust decisions, backups,
  installed runtimes, and dependency directories.
- Wi-Fi names/profiles, host aliases, internal service addresses, device IDs,
  disk UUIDs, personal project notes and machine-maintenance plans.
- Personal identity and contact information unless intentionally approved for
  publication. Commit author metadata is also public when history is public.

Use `.bashrc.local` for shell-specific environment setup and `.gitconfig.local`
for Git identity and host-specific helpers. These files are ignored and must
not be captured. Use environment variables for service endpoints. Read the
service setup in README rather than relying on the maintainer's network.

A public configuration may differ from its live counterpart. A privacy refusal
is a request to separate local data from portable settings, not to force-add it.
Files kept ignored in a maintainer's checkout must never be included in a public
archive or deployment. Export from a reviewed Git tree, not `tar` of a checkout.

## Enforcement

- `.gitignore` prevents common accidental additions. It is not an access-control
  mechanism and does not protect files already tracked or force-added.
- `scripts/privacy-check.py` validates tracked content, forbidden paths,
  nonportable identifiers, symlinks, and size/type boundaries. `--staged`
  validates what will actually be committed, not just the working copy.
- `scripts/capture.sh` validates candidates before copying; it does not add new
  files. Review selected paths rather than treating home as a trusted source.
- The optional `.githooks/pre-commit` validates staged content and requires
  Gitleaks. Enable it deliberately:

  ```sh
  git config core.hooksPath .githooks
  ```

- `.github/workflows/privacy.yml` runs regression tests, the privacy checker,
  and redacted Gitleaks scanning. Configure the workflow as a required branch
  check after it has run successfully. Hooks alone can be bypassed.
- `.github/CODEOWNERS` requests maintainer review for guardrails and policy
  changes. Enable required code-owner review in branch protection separately;
  merely committing the file does not enforce it.

Install Gitleaks from its official project and verify its release checksum.
CI pins its scanner version. Keep redaction enabled. Do not upload scanner
reports containing credentials or attach private configuration to issues.

## Handling a suspected disclosure

1. Stop capture, commits, pushes, and publication.
2. Report only the path, line, rule, and affected commit IDs. Do not repeat the
   secret value or copy the affected file into the repository as evidence.
3. If a real credential was exposed, arrange rotation/revocation with the owner.
   Deleting a file or rewriting history does not revoke a credential.
4. Agree on remediation of history, releases, artifacts, forks, and caches.
   Never force-push or rewrite existing history without explicit approval.
5. Re-run scanners and review the remaining personal metadata before release.

## Clean-snapshot boundary and release gate

This distribution was exported from reviewed indexed files into an independent
Git repository. The private source repository, its historical machine notes,
and its old commit metadata were not cloned or imported. The initial public
snapshot uses the public GitHub handle and a GitHub noreply email for authorship.
Never add the private repository as a history source, merge its branches, or
push its tags into this repository.

This snapshot is prepared locally only. No remote or public repository has been
created for it. A zero-findings Gitleaks result is evidence about recognizable
secrets, not a guarantee against every privacy disclosure.

Before publishing:

- [ ] Review every branch/tag and the intended commit author identity.
- [x] Choose an explicitly approved clean public snapshot, keeping private history separate.
- [ ] Scan the exact public snapshot and, if retained, all its Git history.
- [ ] Check that no ignored local notes or runtime files entered the export.
- [ ] Review binaries, license notices, package provenance, issues, releases,
      wiki content, and CI artifacts.
- [ ] Pass tests and a scratch-HOME install without private services or auth.
- [ ] Configure required privacy checks and available GitHub secret protections.
- [ ] Obtain explicit approval to publish/change visibility.

Do not check these boxes merely because the current working tree is clean.
