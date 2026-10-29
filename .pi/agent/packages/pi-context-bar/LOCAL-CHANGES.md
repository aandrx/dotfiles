# Local changes

Based on npm `pi-context-bar` 0.1.0, with the upstream MIT license preserved.

The maintained `extensions/context-bar.ts` adds session naming, mode/task
progress, cache read/write metrics, cache-aware context coloring, throughput,
and the local footer layout/cost ordering. These changes were captured from
the working local package, not generated from the npm release.

Pi settings must reference `./packages/pi-context-bar`. Do not substitute
`npm:pi-context-bar`: that loads upstream behavior instead. To update upstream,
compare the new release with this tree, reapply/review the customizations, and
verify the footer in an isolated Pi session. Keep the upstream license and
record any new changes here.
