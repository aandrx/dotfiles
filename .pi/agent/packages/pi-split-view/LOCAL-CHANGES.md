# Local changes

Based on npm `pi-split-view` 1.2.1, with the upstream MIT license preserved.

`widgetLines()` in `split-view.ts` returns an empty list to disable the widget.
The rest of the source remains the maintained local copy. Upstream screenshot
assets are omitted because they are not required at runtime.

Pi settings must reference `./packages/pi-split-view`, not the upstream npm
source. When updating upstream, review and retain the intended behavior, test
it in an isolated Pi session, and keep the upstream license.
