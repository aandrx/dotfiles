# Refactor

1. State the structural problem and establish observable behavior that must remain unchanged.
2. Identify affected boundaries, callers, and tests before editing.
3. Change structure in the smallest independently verifiable units.
4. Preserve public behavior and remove obsolete paths only after callers migrate.
5. Run focused tests and relevant broader checks after each meaningful unit.
6. Compare the original and final behavior, then report any unverified surface.
