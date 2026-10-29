import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { freshUsageTotals, foldUsage } from "../lib/usage.ts";
import dshTokenMeter from "../dsh-token-meter.ts";
export default dshTokenMeter;
const isMain = !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  test("usage folds finalized messages additively, including distinct retries", () => {
    const totals = freshUsageTotals();
    foldUsage(totals, { input: 3, output: 2, cacheRead: 4, cacheWrite: 1 });
    foldUsage(totals, { input: 3, output: 2, cacheRead: 4, cacheWrite: 1 });
    assert.deepEqual([totals.input, totals.output, totals.cacheRead, totals.cacheWrite], [6, 4, 8, 2]);
  });
  test("optional buckets only accumulate complete valid values", () => {
    const totals = freshUsageTotals();
    foldUsage(totals, { input: 1, cacheWrite1h: 5, reasoning: 2 });
    foldUsage(totals, { input: 1 });
    assert.equal(totals.cacheWrite1h, 5);
    assert.equal(totals.reasoning, 2);
    foldUsage(totals, { input: -1, output: 8 });
    assert.equal(totals.input, 2);
    assert.equal(totals.output, 0);
  });
}
