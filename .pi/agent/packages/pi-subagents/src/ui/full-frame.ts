import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Frame ANSI-rendered lines inside a responsive rectangular border. */
export function fullFrame(lines: string[], width: number, color: (text: string) => string): string[] {
  const w = Math.max(1, Math.floor(width));
  if (w < 4) return lines.map(line => truncateToWidth(line, w));
  const inner = w - 4;
  const horizontal = "─".repeat(w - 2);
  const result = [color(`╭${horizontal}╮`)];
  for (const line of lines) {
    const clipped = truncateToWidth(line, inner);
    const pad = Math.max(0, inner - visibleWidth(stripTerminalSequences(clipped)));
    result.push(`${color("│")} ${clipped}${" ".repeat(pad)} ${color("│")}`);
  }
  result.push(color(`╰${horizontal}╯`));
  return result;
}
