---
name: pi-operations
description: Use for Pi configuration, packages, extensions, models, providers, skills, agents, workflows, delegation, sessions, or storage. Do not use for generic application engineering.
---

# Pi operations

1. Read the installed Pi documentation page for the exact subsystem before changing it.
2. Inspect only the relevant effective files, such as settings, role definitions, workflow scripts, or extension source.
3. Do not read or print authentication files or provider key values; inspect permissions and metadata when auditing secrets.
4. Keep Pi Crew as the only delegation path unless the user explicitly changes that architecture.
5. Test packages with an explicit temporary agent directory, disabled discovery, and isolated session storage before installation.
6. Stop before editing live Pi settings, swapping role models, installing packages, or deleting sessions unless explicitly requested.
