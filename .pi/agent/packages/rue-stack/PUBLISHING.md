# Publishing rue-stack

This repository holds three tiers of the same setup. They are not copies of each other, and the flow between them is one-directional.

| Tier | Role | Flow |
|---|---|---|
| **Live** | the machine that runs Pi | edited constantly; authoritative for behaviour |
| **Private** (`dotfiles-private`) | live adapted for other personal machines, with portable placeholder paths and names | captured from live |
| **Public** (this tree) | a reference implementation of the stack, safe to read without exposing a real machine | promoted from private by hand |

## Rules

1. **Never capture live into the public tree.** `scripts/capture.sh` targets the private layout. Running it against public overwrites sanitized files and invalidates the hashes in `VENDOR.json`.
2. **Public changes are promotions, not syncs.** Treat them as a pull request: read the diff, confirm nothing host-specific was added, and say what changed and why in the commit message.
3. **Nothing flows public to live automatically.** If a public explanation is worth adopting locally, edit live and let it travel through private.
4. **Sanitized content is public's own content.** Paths, hostnames and examples in the public tree may differ from live on purpose. They are recorded in `LOCAL-CHANGES.md`, and any vendored file changed that way has its hash and patch reason updated in `VENDOR.json`.
5. **Touch public least.** Publish when a concept, a skill or an explanation genuinely changed. Cosmetic drift is not a reason.

## Before promoting

```bash
node eval/check.mjs          # catalog budget, vendor hashes, brand and license checks
grep -ril '/home/rue\|aandrx' .   # should return only unavoidable repository URLs
```

If a vendored skill must change for publication, edit it, rehash it, and update its `patch_reason`. A manifest that describes a file which no longer exists is worse than no manifest.

## What public is for

Reading, adapting, and borrowing. It is a worked example of a skill-driven agent setup, not an install image. Model names, thinking levels and the agent roster are specific to one machine and will not transfer unchanged.
