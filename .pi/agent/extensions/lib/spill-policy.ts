import * as fs from "node:fs";
import * as path from "node:path";
import { CHARS_PER_TOKEN, estimateContent } from "./estimate.ts";
import { codePointLength, codePointSlice } from "./compaction.ts";

export type Estimator = (text: string) => number;
export function defaultSpillEstimator(text: string): number {
  return estimateContent([{ type: "text", text }]);
}
export function spillPolicy(text: string, maxInlineTokens: number, estimator: Estimator = defaultSpillEstimator, headTokens = maxInlineTokens * 0.8) {
  const tokens = estimator(text);
  if (tokens <= maxInlineTokens) return { shouldSpill: false, head: text, tail: "", omittedBytes: 0 };
  const points = codePointLength(text);
  const headChars = Math.floor(headTokens * CHARS_PER_TOKEN);
  const tailChars = Math.floor((maxInlineTokens - headTokens) * CHARS_PER_TOKEN);
  const h = Math.min(headChars, points), t = Math.min(tailChars, points - h);
  const omitted = codePointSlice(text, h, points - t);
  return { shouldSpill: true, head: codePointSlice(text, 0, h), tail: t ? codePointSlice(text, points - t) : "", omittedBytes: Buffer.byteLength(omitted, "utf8") };
}
import { createHash, randomBytes } from "node:crypto";
export function hashedSessionId(id: string): string { return createHash("sha256").update(id).digest("hex"); }

function assertRealDirectory(dir: string): void {
  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("unsafe spill directory");
}

export function storeSpill(root: string, sessionId: string, text: string): { locator: string; bytes: number; path: string } {
  const absoluteRoot = path.resolve(root);
  fs.mkdirSync(absoluteRoot, { recursive: true, mode: 0o700 });
  assertRealDirectory(absoluteRoot);
  const dir = path.join(absoluteRoot, hashedSessionId(sessionId));
  try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  assertRealDirectory(dir);
  const contained = (candidate: string) => candidate.startsWith(absoluteRoot + path.sep);
  if (!contained(dir) || path.dirname(dir) !== absoluteRoot) throw new Error("spill path escaped root");
  const bytes = Buffer.byteLength(text, "utf8");
  for (let i=0;i<8;i++) {
    const name = `${randomBytes(24).toString("hex")}.md`;
    const file = path.join(dir,name);
    if (!contained(file) || path.dirname(file) !== dir) throw new Error("spill path escaped root");
    try { const fd=fs.openSync(file,"wx",0o600); try { fs.writeFileSync(fd,text,"utf8"); } catch (e) { try { fs.closeSync(fd); } catch {} try { fs.unlinkSync(file); } catch {} throw e; } fs.closeSync(fd); return { locator:`${path.basename(dir)}/${name}`, bytes, path:file }; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  }
  throw new Error("could not allocate spill file");
}
