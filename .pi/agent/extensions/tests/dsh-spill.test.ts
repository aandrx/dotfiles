import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spillPolicy, storeSpill } from "../lib/spill-policy.ts";
import { sweepSpillRoot } from "../lib/spill-cleanup.ts";
import { pruneOversizedToolResults, resolvePruneConfig } from "../lib/compaction.ts";
import dshSpill from "../dsh-spill.ts";

const isMain = !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
function sha256hex(id: string): string { return createHash("sha256").update(id).digest("hex"); }
export default function noop(): void {}

function harness() {
  const handlers = new Map<string, Function>();
  const tools = new Map<string, any>();
  const notices: unknown[] = [];
  const pi: any = {
    on(name: string, fn: Function) { handlers.set(name, fn); },
    registerTool(tool: any) { tools.set(tool.name, tool); },
    notify(...args: unknown[]) { notices.push(args); },
  };
  dshSpill(pi);
  return { handlers, tools, notices };
}

if (isMain) {
 test("token budget and UTF-8 omitted bytes",()=>{ const text="a".repeat(100)+"é".repeat(40)+"z".repeat(100); const p=spillPolicy(text,10,()=>20,8); assert.equal(p.shouldSpill,true); assert.ok(p.head.length>0); assert.ok(p.tail.length>0); assert.equal(p.omittedBytes,Buffer.byteLength(text.slice(p.head.length,text.length-p.tail.length))); assert.ok(p.omittedBytes>0); });
 test("safe hashed exclusive storage",()=>{ const root=fs.mkdtempSync(path.join(os.tmpdir(),"spill-")); try { const x=storeSpill(root,"../../bad","é"); assert.equal(x.bytes,2); assert.equal(fs.readFileSync(x.path,"utf8"),"é"); assert.equal(fs.statSync(x.path).mode&0o777,0o600); assert.ok(x.path.startsWith(root+path.sep)); } finally {fs.rmSync(root,{recursive:true,force:true});} });
 test("head and tail never split surrogate pairs",()=>{const p=spillPolicy("a😀bc😀d",1.2,()=>3,0.6);assert.equal(p.head,"a😀");assert.equal(p.tail,"😀d");assert.equal(p.omittedBytes,Buffer.byteLength("bc"));});
 test("reject symlinked root and session directory",()=>{const base=fs.mkdtempSync(path.join(os.tmpdir(),"spill-"));try{const real=path.join(base,"real");fs.mkdirSync(real);const root=path.join(base,"linked-root");fs.symlinkSync(real,root);assert.throws(()=>storeSpill(root,"id","x"));const sessionRoot=path.join(base,"sessions");fs.mkdirSync(sessionRoot);const hashed=path.join(sessionRoot,(sha256hex("id")));fs.symlinkSync(real,hashed);assert.throws(()=>storeSpill(sessionRoot,"id","x"));}finally{fs.rmSync(base,{recursive:true,force:true});}});
 test("TTL boundary retains exact age and removes strictly older files",()=>{ const root=fs.mkdtempSync(path.join(os.tmpdir(),"spill-")); try {const dir=path.join(root,"session");fs.mkdirSync(dir);const exact=path.join(dir,"exact"),older=path.join(dir,"older");fs.writeFileSync(exact,"x");fs.writeFileSync(older,"x");const now=Date.now(),day=86400000;fs.utimesSync(exact,new Date(now-30*day),new Date(now-30*day));fs.utimesSync(older,new Date(now-30*day-1000),new Date(now-30*day-1000));sweepSpillRoot(root,30,now);assert.equal(fs.existsSync(exact),true);assert.equal(fs.existsSync(older),false);}finally{fs.rmSync(root,{recursive:true,force:true});} });
 test("spill cleanup skips symlink files, honors disabled TTL and survives bad roots",()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"spill-"));try{const dir=path.join(root,"session");fs.mkdirSync(dir);const target=path.join(root,"target");fs.writeFileSync(target,"keep");const link=path.join(dir,"link");fs.symlinkSync(target,link);sweepSpillRoot(root,30,Date.now()+40*86400000);assert.equal(fs.lstatSync(link).isSymbolicLink(),true);assert.equal(fs.readFileSync(target,"utf8"),"keep");const fresh=path.join(dir,"fresh");fs.writeFileSync(fresh,"x");sweepSpillRoot(root,0,Date.now()+100*86400000);assert.equal(fs.existsSync(fresh),true);const notDir=path.join(root,"not-a-directory");fs.writeFileSync(notDir,"not a directory");assert.doesNotThrow(()=>sweepSpillRoot(notDir,30));assert.equal(fs.existsSync(notDir),true);}finally{fs.rmSync(root,{recursive:true,force:true});}});
 test("tool-result wiring spills, preserves non-text, exact notice and read-back", async()=>{
   const {handlers,tools}=harness(); const original=process.env.DSH_SPILL_MAX_INLINE_TOKENS;
   process.env.DSH_SPILL_MAX_INLINE_TOKENS="1";
   try {
     const text="0123456789".repeat(1000), image={type:"image",data:"kept"};
     const event:any={isError:false,content:[image,{type:"text",text}]};
     const result=handlers.get("tool_result")!(event,{sessionManager:{getSessionId:()=>"wiring-test"}});
     assert.equal(result.content,event.content);
     const stub=event.content.find((b:any)=>b.type==="text").text;
     assert.deepEqual(event.content[0],image);
     const match=stub.match(/\(Omitted (\d+) bytes\. 1 image kept inline\. Full formatted result stored at: ([^.]*(?:\.[^.]*)?)\. Use spill_read to retrieve omitted content\.\)/);
     assert.ok(match,stub); const [,bytes,locator]=match;
     assert.equal(stub.includes(`(Omitted ${bytes} bytes. 1 image kept inline. Full formatted result stored at: ${locator}. Use spill_read to retrieve omitted content.)`),true);
     const read=await tools.get("spill_read").execute("id",{locator,offsetChars:0,limitChars:text.length});
     assert.ok(read.content[0].text.endsWith(text));
   } finally { if(original===undefined)delete process.env.DSH_SPILL_MAX_INLINE_TOKENS;else process.env.DSH_SPILL_MAX_INLINE_TOKENS=original; }
 });
 test("spill notice counts omitted images and reports pi truncation",()=>{
   const {handlers}=harness(), old=process.env.DSH_SPILL_MAX_INLINE_TOKENS;
   process.env.DSH_SPILL_MAX_INLINE_TOKENS="1";
   try {
     for (const [text, expected] of [["x".repeat(100000), "1 image kept inline."], ["x".repeat(100000)+"\\nFull output: /some/path", "[note: pi truncated output above this point; complete log at /some/path]"]] as const) {
       const event:any={isError:false,content:[{type:"image",data:"x"},{type:"text",text}]};
       handlers.get("tool_result")!(event,{sessionManager:{getSessionId:()=>"notice-test"}});
       const stub=event.content.find((b:any)=>b.type==="text").text;
       assert.ok(stub.includes(expected),stub);
     }
   } finally {if(old===undefined)delete process.env.DSH_SPILL_MAX_INLINE_TOKENS;else process.env.DSH_SPILL_MAX_INLINE_TOKENS=old;}
 });
 test("no-spill leaves input untouched and configured budget is honored",()=>{
   const {handlers}=harness(), text="small result", content:any[]=[{type:"text",text}], event:any={isError:false,content};
   const old=process.env.DSH_SPILL_MAX_INLINE_TOKENS; process.env.DSH_SPILL_MAX_INLINE_TOKENS="10000";
   try { assert.equal(handlers.get("tool_result")!(event,{sessionManager:{}}),undefined); assert.equal(event.content,content); assert.deepEqual(content,[{type:"text",text}]); }
   finally {if(old===undefined)delete process.env.DSH_SPILL_MAX_INLINE_TOKENS;else process.env.DSH_SPILL_MAX_INLINE_TOKENS=old;}
 });
 test("spill write failure leaves original tool-result intact",()=>{
   const {handlers}=harness(), text="x".repeat(100000), content:any[]=[{type:"text",text}], event:any={isError:false,content};
   const oldHome=process.env.HOME, oldBudget=process.env.DSH_SPILL_MAX_INLINE_TOKENS;
   const bad=fs.mkdtempSync(path.join(os.tmpdir(),"spill-home-")); fs.writeFileSync(path.join(bad,".pi"),"not a directory"); process.env.HOME=bad; process.env.DSH_SPILL_MAX_INLINE_TOKENS="1";
   try { assert.equal(handlers.get("tool_result")!(event,{sessionManager:{}}),undefined); assert.equal(event.content,content); assert.equal(content[0].text,text); }
   finally {if(oldHome===undefined)delete process.env.HOME;else process.env.HOME=oldHome;if(oldBudget===undefined)delete process.env.DSH_SPILL_MAX_INLINE_TOKENS;else process.env.DSH_SPILL_MAX_INLINE_TOKENS=oldBudget;fs.rmSync(bad,{recursive:true,force:true});}
 });
 test("spill stub is stable under re-spill and compaction pruning",()=>{
   const {handlers}=harness(), old=process.env.DSH_SPILL_MAX_INLINE_TOKENS;
   process.env.DSH_SPILL_MAX_INLINE_TOKENS="1";
   try {
     const event:any={isError:false,content:[{type:"text",text:"0123456789".repeat(1000)}]};
     handlers.get("tool_result")!(event,{sessionManager:{getSessionId:()=>"int2"}});
     const snapshot=JSON.stringify(event.content);
     assert.ok(snapshot.includes("Full formatted result stored at:"));
     // Spill and compaction subscribe to disjoint hooks (tool_result vs
     // session_before_compact); a second pass over the stub must not re-spill.
     assert.equal(handlers.get("tool_result")!(event,{sessionManager:{getSessionId:()=>"int2"}}),undefined);
     assert.equal(JSON.stringify(event.content),snapshot);
     // Compaction pruning on the replayed copy leaves the under-budget stub untouched.
     const stub=event.content.find((b:any)=>b.type==="text").text;
     const msgs=[{role:"toolResult",content:[{type:"text",text:stub}]}];
     assert.deepEqual(pruneOversizedToolResults(msgs as any,resolvePruneConfig(undefined)),msgs);
     // Oversized replay copy: pruning rewrites only the replay copy to
     // head/marker/tail while the durable source stays byte-identical.
     const big={role:"toolResult",content:[{type:"text",text:"y".repeat(20000)}]};
     const durable=JSON.stringify(big);
     const pruned=pruneOversizedToolResults([big] as any,resolvePruneConfig(undefined));
     assert.ok(pruned[0].content[0].text.length<20000);
     assert.ok(pruned[0].content[0].text.includes("pruned"));
     assert.equal(JSON.stringify(big),durable);
   } finally {if(old===undefined)delete process.env.DSH_SPILL_MAX_INLINE_TOKENS;else process.env.DSH_SPILL_MAX_INLINE_TOKENS=old;}
 });
}
