/**
 * framed-select.ts — a picker that floats, like every other surface here.
 *
 * `ctx.ui.select` draws inline into the conversation, so the flow menu it
 * serves reads as a page of chat rather than a dialog. The agent menus and the
 * workflow inspector are centered overlays; a picker reached from one of them
 * should not suddenly behave unlike the thing it opens. In a real terminal this
 * therefore renders the same framed `SelectList` overlay the `/agents` menu
 * uses; headless/RPC keeps the plain `select`, which is the only picker those
 * modes have.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { SelectList, truncateToWidth } from "@earendil-works/pi-tui";
import { fullFrame } from "./full-frame.js";

/** Rows shown before the list scrolls, so a long menu does not fill the screen. */
const MAX_VISIBLE_ROWS = 12;

export async function framedSelect(
  ctx: ExtensionCommandContext,
  title: string,
  options: readonly string[],
  format: (value: string, innerWidth: number) => string = value => value,
): Promise<string | undefined> {
  if (ctx.mode !== "tui") {
    // `ctx.ui.select` deals in strings. Format the rows the same way the
    // overlay does, then map the chosen LABEL back to its value: returning the
    // label here would hand the caller a display string it cannot resolve (and
    // would have shown a bare id instead of the columns).
    const inner = Math.max(20, (process.stdout.columns ?? 100) - 4);
    const rows = options.map(value => ({ value, label: format(value, inner) }));
    // A truncated column can collide, and colliding labels resolve to the first
    // match. Disambiguate so every option maps back one-to-one.
    const seen = new Map<string, number>();
    for (const row of rows) {
      const base = row.label;
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      if (count > 0) row.label = `${base} #${count + 1}`;
    }
    const picked = await ctx.ui.select(title, rows.map(row => row.label));
    return rows.find(row => row.label === picked)?.value;
  }

  return ctx.ui.custom<string | undefined>(
    (tui, theme, _keybindings, done) => {
      const items = options.map(value => ({ value, label: value }));
      const selectList = new SelectList(items, Math.min(items.length, MAX_VISIBLE_ROWS), {
        selectedPrefix: text => theme.fg("accent", text),
        selectedText: text => theme.fg("accent", text),
        description: text => theme.fg("muted", text),
        scrollInfo: text => theme.fg("dim", text),
        noMatch: text => theme.fg("warning", text),
      });
      selectList.onSelect = item => done(item.value);
      selectList.onCancel = () => done(undefined);
      return {
        render(width: number) {
          const inner = Math.max(1, Math.min(width, tui.terminal?.columns ?? width) - 4);
          for (const item of items) item.label = truncateToWidth(format(item.value, inner), inner);
          return fullFrame(
            [
              theme.fg("accent", theme.bold(title)),
              ...selectList.render(inner),
              theme.fg("dim", "↑↓ navigate · enter select · esc cancel"),
            ],
            width,
            str => theme.fg("accent", str),
          );
        },
        invalidate() {
          selectList.invalidate();
        },
        handleInput(data: string) {
          selectList.handleInput(data);
          tui.requestRender();
        },
      };
    },
    { overlay: true, overlayOptions: { anchor: "center", width: "100%", minWidth: 32, maxHeight: MAX_VISIBLE_ROWS + 4 } },
  );
}
