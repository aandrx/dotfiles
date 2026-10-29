---
name: quality
description: Use for review-first work, including end-to-end verification, edge-case sweeps, and optimisation with proof that behaviour still works. Do not use for routine implementation.
disable-model-invocation: true
---

# Quality review

1. Name what is under review and the risk that matters most: a diff, a subsystem, or a release candidate.
2. Enumerate user-facing paths. For each, record the exact command or interaction, the expected observable result, and the actual result. Include the happy path, empty input, invalid input, boundary values, and failure recovery.
3. Run every row. Mark each pass or fail with the evidence. Never present an unrun case as covered.
4. For cross-module risk, read `../blast-radius/SKILL.md` and prove what could break rather than listing callers.
5. For any performance claim, read `../benchmark-checklist/SKILL.md`, measure before and after with a repeatable command, name the limiter, and confirm the feature still works end to end after the change.
6. When the repo has no scripted way to drive the app, read `../create-verification-skill/SKILL.md` and build one first.
7. Report findings by severity with file and line, consequence, and confidence. Separate observed from inferred. Do not edit here; to fix a confirmed finding, switch to /shipp and reference the finding id.

Stop and report when a required surface cannot be exercised; an untested path is a finding, not a pass.
