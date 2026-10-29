# Licensing and third-party provenance

Original repository content and original local modifications are licensed
under the MIT license in [LICENSE](LICENSE), to the extent owned by aandrx.
This collection also contains third-party work: its existing licenses,
copyrights, attribution, and restrictions remain applicable. The root MIT
license does not relicense that material or override component-specific terms.

Preserve each component's copyright, license, and attribution. In particular,
the collection must not be described as entirely MIT-licensed or unrestricted.

## Maintained local packages

| Path | Provenance / license |
| --- | --- |
| `.pi/agent/packages/pi-context-bar/` | `pi-context-bar` 0.1.0; MIT; local footer changes. See its `LICENSE` and `LOCAL-CHANGES.md`. |
| `.pi/agent/packages/pi-split-view/` | `pi-split-view` 1.2.1; MIT; local widget behavior change. See its `LICENSE` and `LOCAL-CHANGES.md`. |
| `.pi/agent/packages/pi-subagents/` | Maintained local source; preserve the package's `LICENSE`. |
| `.pi/agent/packages/rue-stack/` | Mixed upstream and local work. See `VENDOR.json`, `LICENSES/`, and individual skill licenses. |

`rue-stack/LICENSES/` records upstream license texts. `VENDOR.json` records
upstream revisions and transformed-file provenance; it is not proof that every
current local file still matches the recorded hashes. Review/update provenance
when changing vendored material, rather than regenerating it blindly.

The `agentation` skill carries **PolyForm Shield 1.0.0**, including restrictions
on competing products/services. It must not be presented as MIT or unrestricted
open source. Other skill-local licenses take precedence for those components.

The separately installed `frontend-design` skill had an all-rights-reserved /
commercial-terms notice. It is not part of the public distributable tree unless
redistribution permission is established. A local maintainer may retain an
ignored copy; installers must not include that copy.

Theme icons, shaders, and other configuration assets may have separate origins.
Keep existing author notices. This inventory is not a legal opinion or a blanket
certification of all third-party redistribution rights. Resolving uncertain
provenance remains part of the public-release checklist in `PRIVACY.md`.
