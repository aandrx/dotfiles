/**
 * Package entry point.
 *
 * Pi labels a non-package relative extension by its path with a trailing
 * `index.ts`/`index.js` segment dropped, so this wrapper exists only to make the
 * `[Extensions]` startup list read `pi-subagents` instead of `src`. The
 * extension itself lives in `../src/index.ts`; this re-exports its default (the
 * `(pi) => void` installer) unchanged.
 */
export { default } from "../src/index.js";
