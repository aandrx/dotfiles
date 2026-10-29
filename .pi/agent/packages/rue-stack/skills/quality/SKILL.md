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
6. For diff-visible performance defects, run the four-cluster triage below. Skip items that need profiler evidence; do not speculate about thread counts or allocation lifetime you cannot see.
7. When the repo has no scripted way to drive the app, read `../create-verification-skill/SKILL.md` and build one first.
8. Report findings by severity with file and line, consequence, and confidence. Separate observed from inferred. Do not edit here; to fix a confirmed finding, switch to /shipp and reference the finding id.

## Performance triage

Only these four clusters are decidable from the diff. Each needs a concrete pointer to the offending lines.

- **Redundant passes and missing exits.** The same collection traversed twice, filter-then-loop-then-map, no early return in a loop guard, repeated stat/exists where one call serves, or an N+1 access pattern.
- **Serialized independent work.** An await inside a loop with no cross-iteration dependency, unrelated awaits on consecutive lines, or work deferred that could overlap the wait. This is the strongest signal in a diff.
- **Unbounded fan-out.** A task, thread, or Promise.all per input item with no semaphore or queue bound, or a fixed pool size while input scales with the user.
- **Batch and memory boundaries.** A slice grown without preallocation inside a loop, allocation in a hot loop, a whole table or file materialized where the caller iterates once, a fixed batch size with no chunking, membership tests by slice scan inside a loop, or an eager load used in one branch.

Cap the findings. Label each **Important**, **Nit**, or **Pre-existing**, and establish pre-existing with `git blame` rather than assumption. Do not re-report a finding already raised in an earlier cycle, and stop after three review cycles on the same change; further cycles mostly re-flag old code.

Stop and report when a required surface cannot be exercised; an untested path is a finding, not a pass.
