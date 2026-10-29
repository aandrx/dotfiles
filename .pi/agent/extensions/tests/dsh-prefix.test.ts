import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { hashTranscript, default as prefix } from "../dsh-prefix.ts";
const isMain = !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
export default function noop() {}
if (isMain) {
 test("canonical transcript hash detects changes and ordering", () => {
  const messages=[{role:"system",content:"s"},{role:"user",content:"u"}];
  assert.equal(hashTranscript(messages),hashTranscript(messages));
  assert.notEqual(hashTranscript(messages),hashTranscript([{...messages[0]},{role:"user",content:"different"}]));
  assert.notEqual(hashTranscript(messages),hashTranscript([...messages].reverse()));
  assert.notEqual(hashTranscript([]),hashTranscript([{}]));
 });
 test("context transcript and warming-decision events are displayed distinctly", async () => {
  const listeners=new Map<string,Function>(), commands=new Map<string,any>();
  const pi:any={on:(n:string,f:Function)=>listeners.set(n,f),registerCommand:(n:string,c:any)=>commands.set(n,c)};
  prefix(pi);
  const notices:string[]=[];
  const ctx:any={getSystemPrompt:()=>"system",ui:{notify:(s:string)=>notices.push(s)}};
  listeners.get("context_with_system")!({messages:[{role:"system",content:"s"},{role:"user",content:"u"}]},ctx);
  listeners.get("cache_warming_decision")!({warmCost:1,missCost:2,continuationProbability:0.4,action:"warm"},ctx);
  listeners.get("agent_end")!({messages:[{usage:{input:10,cacheRead:3,cacheWrite:2}}]},ctx);
  await commands.get("dsh-prefix").handler("",ctx);
  const first=notices.at(-1)!;
  assert.match(first,/PROMPT-HASH/); assert.match(first,/transcript hash/);
  assert.match(first,/pi cache-warming decision:.*warmCost/);
  assert.match(first,/tool-schema hash: unavailable/);
  assert.match(first,/provider cold-input tokens/); assert.match(first,/prompt-hash changes: 0/); assert.match(first,/transcript changes: 0/);
  assert.doesNotMatch(first,/scheduled|refreshing/i);
  listeners.get("context_with_system")!({messages:[{role:"system",content:"s"},{role:"user",content:"changed"}]},ctx);
  listeners.get("agent_end")!({messages:[]},ctx);
  await commands.get("dsh-prefix").handler("",ctx);
  const command=notices.at(-1)!;
  assert.match(command,/whole-request parity is not claimed/);
  listeners.get("cache_warming_decision")!({warmCost:1,missCost:2,continuationProbability:0.4,action:"stop"},ctx);
  await commands.get("dsh-prefix").handler("",ctx);
  assert.match(notices.at(-1)!,/pi cache-warming decision:.*stop/);
 });
}
