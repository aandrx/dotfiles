import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import {
  CHECKPOINT_PREAMBLE,
  COMPACTION_INSTRUCTION,
  PRUNE_MARKER,
  frameSummaryText,
  pruneOversizedToolResults,
  pruneNotice,
  pruneText,
  resolvePruneConfig,
  resolveSummaryMaxTokens,
  validateSummaryResponse,
} from "../lib/compaction.ts";
import type { DshMessage } from "../lib/estimate.ts";

const isMain = !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
export default function noop() {}

if (isMain) {
  test("COMP-7: pruning notice only appears after actual pruning", () => {
    assert.equal(pruneNotice(false, "overflow", true), null);
    assert.match(pruneNotice(true, "overflow", true)!, /pruned oversized tool results.*overflow; retry=true/);
  });

  test("COMP-1: summary cap mirrors pi reserve, honors override, never exceeds model max", () => {
    assert.equal(resolveSummaryMaxTokens(undefined, 10000, 9000), 8000);
    assert.equal(resolveSummaryMaxTokens(undefined, 1000, 9000), 800);
    assert.equal(resolveSummaryMaxTokens(12000, 1000, 9000), 9000);
    assert.equal(resolveSummaryMaxTokens(undefined, undefined, 9000), 7200);
    assert.equal(resolveSummaryMaxTokens(undefined, 100000, 4000), 4000);
  });

  test("COMP-3: pruner is code-point safe and respects the exact threshold", () => {
    const cfg = resolvePruneConfig({ thresholdChars: 50, headChars: 4, tailChars: 4 });
    assert.equal(pruneText("A".repeat(100), cfg), `AAAA${PRUNE_MARKER}AAAA`);
    assert.equal(pruneText("A".repeat(50), cfg), "A".repeat(50));
    const emojiPruned = pruneText("😀".repeat(60), cfg);
    assert.equal(emojiPruned, `😀😀😀😀${PRUNE_MARKER}😀😀😀😀`);
  });

  test("COMP-3: replay pruner rewrites only tool-result positions; nested ok; originals immutable", () => {
    const cfg = resolvePruneConfig({ thresholdChars: 50, headChars: 4, tailChars: 4 });
    const big = "z".repeat(100);
    const pruned = `zzzz${PRUNE_MARKER}zzzz`;
    const toolMsg = { role: "assistant", content: [{ type: "tool-result", content: [{ type: "text", text: big }] }] };
    const nested = { role: "toolResult", content: [{ type: "text", text: big }] };
    const unrelatedToolNamed = { role: "assistant", content: [{ type: "my-tool-widget", text: big }] };
    const plainUser = { role: "user", content: [{ type: "text", text: big }] };
    const noContent = { role: "assistant" };
    const notObject = 42;
    const out = pruneOversizedToolResults(
      [toolMsg, nested, unrelatedToolNamed, plainUser, noContent, notObject],
      cfg,
    );
    // Tool-result positions rewritten to head/marker/tail.
    assert.equal((out[0] as typeof toolMsg).content[0].content[0].text, pruned);
    assert.equal(((out[1] as typeof nested).content[0] as { text: string }).text, pruned);
    // Unrelated shapes pass through by identity.
    assert.equal(out[2], unrelatedToolNamed);
    assert.equal(out[3], plainUser);
    assert.equal(out[4], noContent);
    assert.equal(out[5], notObject);
    // Originals untouched.
    assert.equal(toolMsg.content[0].content[0].text, big);
    assert.equal((nested.content[0] as { text: string }).text, big);
  });

  test("COMP-2: fail-closed validation rejects truncation, empty, and non-shrinking summaries", () => {
    const bigSource: DshMessage[] = [
      { role: "user", content: [{ type: "text", text: "x".repeat(20000) }] },
    ];
    const tinySource: DshMessage[] = [{ role: "user", content: [{ type: "text", text: "hi" }] }];

    assert.deepEqual(
      validateSummaryResponse({ stopReason: "length", summaryText: "partial", sourceMessages: bigSource }),
      { ok: false, reason: "truncated" },
    );
    assert.deepEqual(
      validateSummaryResponse({ stopReason: "stop", summaryText: "   \n ", sourceMessages: bigSource }),
      { ok: false, reason: "empty" },
    );
    assert.deepEqual(
      validateSummaryResponse({ stopReason: "stop", summaryText: "y".repeat(2000), sourceMessages: tinySource }),
      { ok: false, reason: "no-shrink" },
    );

    const ok = validateSummaryResponse({ stopReason: "stop", summaryText: "done. fixed bug.", sourceMessages: bigSource });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.framed, frameSummaryText("done. fixed bug."));
  });

  test("COMP-8: framing exact; dead ports absent; headers state pi ownership", () => {
    assert.equal(
      frameSummaryText("summary"),
      `${CHECKPOINT_PREAMBLE}\n\n<compacted-summary>\nsummary\n</compacted-summary>`,
    );
    assert.ok(COMPACTION_INSTRUCTION.includes("Output EXACTLY the Markdown structure below"));
    const libSource = readFileSync(new URL("../lib/compaction.ts", import.meta.url), "utf8");
    for (const name of ["DshCompactionPolicy", "DEFAULT_POLICY", "DshResolvedSpec", "resolveCompactSpec", "BalancedFn", "selectCompactableRange"]) {
      assert.equal(libSource.includes(name), false, `${name} must be removed`);
    }
    assert.ok(libSource.includes("pi owns"), "lib header must state pi owns the cut");
    const rootSource = readFileSync(new URL("../dsh-compaction.ts", import.meta.url), "utf8");
    assert.ok(rootSource.includes("pi owns"), "root header must state pi owns the cut");
    assert.ok(rootSource.includes("non-goal"), "root header must record the non-goals");
  });
}
