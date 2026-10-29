---
name: machine-maintenance
description: Use for operating-system services, general networking, power use, idle resources, hardware behavior, or machine-level configuration. Do not use for Git-hosting SSH authentication, repository operations, or application-only bugs.
---

# Machine maintenance

1. Capture current evidence with the narrowest relevant commands, such as `systemctl status`, `systemctl --user status`, `ps`, journal queries, or a power sampler.
2. Identify whether the state is current, historical, system-wide, or user-scoped.
3. Change one reversible variable at a time and record the baseline.
4. Verify after the relevant restart, login, suspend cycle, or reboot when required.
5. Preserve documented user decisions and recovery paths.
6. Stop before package removal, privileged file edits, service masking, network migration, or destructive cleanup unless explicitly approved.
