import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { estimateMessage, estimateContent, foldSurfaceTokens, surfaceTotal } from "../lib/estimate.ts";
import type { DshSurfaceNode } from "../lib/estimate.ts";
export default function noop() {}
const isMain = !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  test("system messages use rendered text pricing", () => {
    assert.equal(estimateMessage({ role: "system", content: [{ type: "text", text: "abcd" }] }), 5);
  });
  test("structural blocks include tool results and ignore image offloaded", () => {
    assert.equal(estimateContent([{ type: "tool-result", content: [{ type: "text", text: "abcd" }] }]), 4 + Math.ceil(JSON.stringify({ type: "tool-result", content: [{ type: "text", text: "abcd" }] }).length / 4));
    assert.equal(estimateContent([{ type: "image", data: "x", offloaded: true }]), estimateContent([{ type: "image", data: "x" }]));
  });
  test("surface append and replacement; invalid range throws", () => {
    let nodes: DshSurfaceNode[] = [];
    nodes = foldSurfaceTokens(nodes, { seq: 1, surfaceOp: { op: "append" }, message: { role: "user", content: [{ type: "text", text: "a" }] } }).nodes;
    nodes = foldSurfaceTokens(nodes, { seq: 2, surfaceOp: { op: "append" }, message: { role: "user", content: [{ type: "text", text: "b" }] } }).nodes;
    const replacement = foldSurfaceTokens(nodes, { seq: 3, surfaceOp: { op: "replace", start: 1, end: 2 }, message: null });
    assert.equal(surfaceTotal(replacement.nodes), 0);
    assert.throws(() => foldSurfaceTokens(nodes, { seq: 4, surfaceOp: { op: "replace", start: 8, end: 9 }, message: null }));
  });
}
