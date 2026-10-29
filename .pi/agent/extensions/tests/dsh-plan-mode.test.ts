import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import planMode from "../dsh-plan-mode.ts";
const isMain = !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
export default function noop() {}
if (isMain) {
 function harness(branch: any[] = [], names: string[] = []) {
  const drafts: any[] = [], events = new Map<string, Function>(), commands = new Map<string, any>(), tools = new Map<string, any>(), entries: any[] = [], notices: string[] = [];
  const pi: any = { getAllTools: () => names.map(name => ({name})), createBranchDraft: (...args: any[]) => drafts.push(args), on: (n: string, f: Function) => events.set(n, f), registerCommand: (n: string, c: any) => commands.set(n,c), registerTool: (t: any) => { if (names.includes(t.name)) throw Error("duplicate"); tools.set(t.name,t); }, appendEntry: (type: string,data: any) => entries.push({type,data}) };
  planMode(pi);
  const ctx: any = { sessionManager: { getSessionId: () => "s", getBranch: () => branch }, ui: { notify: (s: string) => notices.push(s) } };
  return { events, commands, tools, entries, notices, drafts, ctx };
 }
 test("registers plan_status without querying runtime tools during extension load", () => {
  const pi: any = {
   on() {}, registerCommand() {}, registerTool(tool: any) { this.registered = tool; },
   getAllTools() { throw new Error("runtime action method called during extension loading"); },
  };
  planMode(pi);
  assert.equal(pi.registered.name, "plan_status");
 });
 test("plan command persists active state; approve persists inactive and unlocks edits", async () => {
  const h=harness(); await h.commands.get("plan").handler("ship feature",h.ctx);
  assert.deepEqual(h.entries[0],{type:"dsh-plan-mode",data:{version:1,active:true,goal:"ship feature"}});
  assert.equal(h.events.get("tool_call")!({toolName:"edit"},h.ctx).block,true);
  assert.equal(h.events.get("tool_call")!({toolName:"write"},h.ctx).block,true);
  assert.equal(h.events.get("tool_call")!({toolName:"read"},h.ctx),undefined);
  await h.commands.get("approve").handler("",h.ctx);
  assert.equal(h.entries[1].data.active,false);
  assert.equal(h.events.get("tool_call")!({toolName:"edit"},h.ctx),undefined);
 });
 test("each command transition persists versioned entries and restores latest branch state", async () => {
  const h=harness();
  await h.commands.get("plan").handler("goal one",h.ctx);
  await h.commands.get("plan-off").handler("",h.ctx);
  await h.commands.get("plan").handler("goal two",h.ctx);
  assert.deepEqual(h.entries.map(e=>e.data),[
   {version:1,active:true,goal:"goal one"},
   {version:1,active:false,goal:null},
   {version:1,active:true,goal:"goal two"},
  ]);
  const restored=harness(h.entries);
  restored.events.get("session_start")!({reason:"resume"},restored.ctx);
  const status=await restored.tools.get("plan_status").execute("",{},null,null,restored.ctx);
  assert.match(status.content[0].text,/goal two/);
 });
 test("restore folds versioned entries from active branch, including off state", async () => {
  const h=harness([{type:"custom",customType:"dsh-plan-mode",data:{version:1,active:true,goal:"restored"}},{type:"custom",customType:"dsh-plan-mode",data:{version:1,active:false,goal:null}}]);
  h.events.get("session_start")!({reason:"resume"},h.ctx);
  const inactive=await h.tools.get("plan_status").execute("",{},null,null,h.ctx);
  assert.match(inactive.content[0].text,/OFF/);
  assert.equal(h.events.get("tool_call")!({toolName:"edit"},h.ctx),undefined);
  const g=harness([{type:"custom",customType:"dsh-plan-mode",data:{version:1,active:true,goal:"fork goal"}}]);
  g.events.get("session_start")!({reason:"fork"},g.ctx);
  assert.equal(g.events.get("tool_call")!({toolName:"write"},g.ctx).block,true);
  const active=await g.tools.get("plan_status").execute("",{},null,null,g.ctx);
  assert.match(active.content[0].text,/fork goal/);
 });
 test("boundary drafts preserve state and plan_status naming/wording is aligned", async () => {
  const h=harness(); await h.commands.get("plan").handler("goal",h.ctx);
  const output=h.events.get("turn_end")!({entries:[]},h.ctx);
  assert.equal(output.entries[0].type,"custom");
  const boundary=h.events.get("agent_before_settle")!({entries:[]},h.ctx);
  assert.deepEqual(boundary.entries[0],output.entries[0]);
  assert.equal(output.entries[0].customType,"dsh-plan-mode"); assert.equal(output.entries[0].data.goal,"goal");
  assert.equal(h.tools.has("plan_status"),true);
  assert.match(h.tools.get("plan_status").description,/\/approve/);
  assert.match(h.commands.get("plan").description,/edit\/write/);
  assert.match(h.commands.get("plan-off").description,/without approving/);
  assert.match(h.commands.get("approve").description,/allowing edit\/write/);
 });
}
