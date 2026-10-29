import type { Usage } from "@earendil-works/pi-ai";

export interface UsageTotals {
  input: number; output: number; cacheRead: number; cacheWrite: number;
  cacheWrite1h?: number; reasoning?: number; costTotal: number;
}

export const freshUsageTotals = (): UsageTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costTotal: 0 });

/** Add each finalized message once; retries are distinct messages. */
export function foldUsage(totals: UsageTotals, usage: Usage | undefined): void {
  if (!usage) return;
  const fields = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite];
  if (fields.some(v => v !== undefined && (!Number.isFinite(v) || v < 0))) return;
  totals.input += usage.input ?? 0;
  totals.output += usage.output ?? 0;
  totals.cacheRead += usage.cacheRead ?? 0;
  totals.cacheWrite += usage.cacheWrite ?? 0;
  if (usage.cacheWrite1h !== undefined && Number.isFinite(usage.cacheWrite1h) && usage.cacheWrite1h >= 0) {
    totals.cacheWrite1h = (totals.cacheWrite1h ?? 0) + usage.cacheWrite1h;
  }
  if (usage.reasoning !== undefined && Number.isFinite(usage.reasoning) && usage.reasoning >= 0) {
    totals.reasoning = (totals.reasoning ?? 0) + usage.reasoning;
  }
  const cost = usage.cost?.total;
  if (cost !== undefined && Number.isFinite(cost) && cost >= 0) totals.costTotal += cost;
}
