import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spillPolicy, storeSpill } from "./lib/spill-policy.ts";
import { sweepSpillRoot } from "./lib/spill-cleanup.ts";

export const MAX_INLINE_TOKENS = 4096;
const SPILL_READ_DEFAULT_LIMIT = 4000;
export function detectPiTruncLog(text: string): string | null { const m=text.match(/Full output:\s*(\S+)/); if(!m)return null; const p=(m[1]??"").replace(/[\]\)"']+$/g,""); return p.startsWith("/")?p:null; }
function spillRoot(): string { return path.join(os.homedir(),".pi","agent","spill"); }
let swept = false;
export default function dshSpill(pi: ExtensionAPI): void {
  pi.on("session_start", () => { if (swept) return; swept=true; try { sweepSpillRoot(spillRoot(), Number(process.env.DSH_SPILL_TTL_DAYS ?? 30)); } catch { /* non-fatal */ } });
  pi.on("tool_result", (event, ctx) => {
    try {
      if (event.isError) return;
      const blocks=event.content.filter((b): b is {type:"text";text:string}=>b.type==="text"); if(!blocks.length)return;
      // Idempotency: never re-spill our own stub (head+tail ≈ budget, so a stub
      // can marginally exceed it). Spill and compaction also subscribe to
      // disjoint hooks (tool_result vs session_before_compact).
      if(blocks.some(b=>b.text.includes("Full formatted result stored at:")))return;
      const full=blocks.map(b=>b.text).join("\n");
      const policy=spillPolicy(full, Number(process.env.DSH_SPILL_MAX_INLINE_TOKENS ?? MAX_INLINE_TOKENS)); if(!policy.shouldSpill)return;
      const id=(ctx.sessionManager as any).getSessionId?.() || "default";
      const stored=storeSpill(spillRoot(),id,full), locator=stored.locator;
      const piLog=detectPiTruncLog(full);
      const omittedImages=event.content.filter((b:any)=>b.type==="image").length;
      // D11: images stay inline, so unlike upstream we never write "Omitted N images.";
      // the notice states how many images were kept inline instead.
      const notice=`(Omitted ${policy.omittedBytes} bytes.${omittedImages?` ${omittedImages} image${omittedImages===1?"":"s"} kept inline.` : ""} Full formatted result stored at: ${locator}. Use spill_read to retrieve omitted content.)`;
      const stub=policy.head+`\n\n${notice}`+(piLog?`\n[note: pi truncated output above this point; complete log at ${piLog}]`:"")+`\n\n`+policy.tail;
      const kept=event.content.filter(b=>b.type!=="text"); kept.push({type:"text",text:stub} as never); event.content.splice(0,event.content.length,...kept as typeof event.content); return {content:event.content};
    } catch { return; }
  });
  pi.registerTool({name:"spill_read",label:"Spill Read",description:"Read a slice of a spilled tool result file.",parameters:Type.Object({locator:Type.String(),offsetChars:Type.Optional(Type.Number()),limitChars:Type.Optional(Type.Number())}),async execute(_id,params){
    try { const offset=Math.max(0,Math.floor(params.offsetChars??0)),limit=Math.min(16000,Math.max(1,Math.floor(params.limitChars??SPILL_READ_DEFAULT_LIMIT))),root=spillRoot(),resolved=path.resolve(root,params.locator); if(resolved!==root&&!resolved.startsWith(root+path.sep))return {content:[{type:"text",text:"spill_read: rejected locator"}],isError:true}; const text=fs.readFileSync(resolved,"utf8"),slice=text.slice(offset,offset+limit); return {content:[{type:"text",text:`spill ${params.locator} [${offset}:${offset+slice.length}/${text.length}]\n${slice}`}]}; } catch{return {content:[{type:"text",text:`spill_read: not found: ${params.locator}`}],isError:true};}
  }});
}
