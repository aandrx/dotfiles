---
name: rue-mode
description: Use for non-trivial investigation of a local repository, source-code bug fixing, feature implementation, refactoring, or another multi-step source-code change. Never use for general web research, release lookups, operational dotfiles, Git, machine maintenance, or Pi configuration unless local source code must also change. Do not use for simple lookups, factual answers, or trivial edits.
---

# Rue mode

Choose exactly one primary playbook:

- Read `../../playbooks/investigation.md` for read-only codebase questions.
- Read `../../playbooks/bug-fix.md` for incorrect behavior.
- Read `../../playbooks/feature.md` for new or changed behavior.
- Read `../../playbooks/refactor.md` for behavior-preserving structural work.

Copy the selected playbook's numbered steps verbatim into `rue_task_state` before implementation. Update each item as work progresses. A skipped item requires a concrete reason. Load domain skills only when their descriptions directly match the task. Stop and report the exact blocker when the required execution surface, project context, or verification path is unavailable.
