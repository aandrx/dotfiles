# Local privacy-maintenance changes

Upstream component licenses and attribution remain in `LICENSES/`, individual
skill directories, and `VENDOR.json`. This file records later local changes;
it does not replace or regenerate the provenance manifest.

Public-tree cleanup:

- `PLAN-V2.md`: removed a reference to a private maintainer machine plan.
- `skills/recall/SKILL.md`: normalized the illustrative home path to a generic
  placeholder; no transcript data is included.
- `eval/e2e/run.mjs`: normalized the synthetic sandbox home to `/home/user`.
  This is an isolated test path, not the maintainer's real home.

Keep real host data out of fixtures and public documentation. Do not run the
credential-dependent E2E harness merely to perform dotfiles privacy checks;
use the repository's synthetic guardrail tests instead.
