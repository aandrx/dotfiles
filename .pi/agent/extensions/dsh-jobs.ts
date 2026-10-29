import { spawn } from "node:child_process";
let spawnProcess: typeof spawn = spawn;

/** Replace the spawn boundary in isolated tests; production defaults to node spawn. */
export function __setSpawnForTest(implementation?: typeof spawn): void {
  spawnProcess = implementation ?? spawn;
}
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { JobRing } from "./lib/job-ring.ts";
import { createJobState, isSettled, requestStop, settleJob, type JobState } from "./lib/job-state.ts";

interface Job { id: string; command: string; cwd: string; child: ReturnType<typeof spawn>; ring: JobRing; startTime: number; state: JobState; timeout?: ReturnType<typeof setTimeout>; waiters: Array<() => void>; owner?: string; notified: boolean; read: boolean; }
const MAX_RUNNING = 4, BUFFER_CAP = 1024 * 1024, DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
let counter = 0, ownerId: string | undefined, ownerCtx: any, wakeCount = 0;
const jobs = new Map<string, Job>();
function ok(text: string, details: unknown = {}) { return { content: [{ type: "text" as const, text }], details }; }
function err(text: string) { return { content: [{ type: "text" as const, text: `Error: ${text}` }], isError: true }; }
function status(j: Job) { return j.state.status; }
function finish(j: Job, result: "completed" | "killed" | "failed", code: number | null, reason?: string, pi?: ExtensionAPI) {
 if (!settleJob(j.state,result,code,reason)) return;
 if (j.timeout) clearTimeout(j.timeout); j.timeout=undefined;
 for (const resolve of j.waiters.splice(0)) resolve();
 if (!j.read && !j.notified && pi && j.owner === ownerId && ownerCtx) { j.notified=true; wakeCount++; // __jobWakeCap defaults to uncapped; otherwise it is the maximum completion wakes per owner session.
 const cap=(ownerCtx as any).__jobWakeCap; if (!cap || wakeCount <= cap) { try { pi.sendMessage({ customType:"dsh-job-complete", content:`${j.id} ${result}${code===null?"":` exit=${code}`}` }, { triggerTurn:true, deliverAs:"followUp" }); } catch {} } }
}
function kill(j: Job, reason: string) { if (!requestStop(j.state,reason)) return false; try { if (j.child.pid !== undefined) process.kill(-j.child.pid,"SIGKILL"); else j.child.kill("SIGKILL"); } catch { try { j.child.kill("SIGKILL"); } catch {} } return true; }
function wait(j: Job, ms: number) { if (isSettled(j.state)) return Promise.resolve(); return new Promise<void>(resolve => { const t=setTimeout(()=>{ j.waiters=j.waiters.filter(x=>x!==done); resolve(); },ms); const done=()=>{clearTimeout(t);resolve();}; j.waiters.push(done); }); }
export default function dshJobs(pi: ExtensionAPI): void {
 pi.on("session_start", (event, ctx) => { ownerId=ctx.sessionManager.getSessionId?.() ?? String((event as any).sessionId ?? "session"); ownerCtx=ctx; wakeCount=0; if(event.reason === "new" || event.reason === "resume" || event.reason === "fork") { for(const j of jobs.values()) if(!isSettled(j.state)) kill(j,"session replaced"); jobs.clear(); } });
 pi.on("session_shutdown", () => { for(const j of jobs.values()) if(!isSettled(j.state)) kill(j,"session shutdown"); ownerId=undefined; ownerCtx=undefined; });
 pi.on("session_before_switch",()=>{}); pi.on("before_fork",()=>{});
 pi.registerTool({ name:"job_start", label:"Job Start", description:"Start a detached background shell command. Returns immediately.", parameters:Type.Object({command:Type.String(),cwd:Type.Optional(Type.String()),timeoutMs:Type.Optional(Type.Number())}), async execute(_id,p,_s,_u,ctx){
  if([...jobs.values()].filter(j=>!isSettled(j.state)).length>=MAX_RUNNING) return err(`Job limit reached: ${MAX_RUNNING} jobs already running.`);
  const command=String(p.command??""); if(!command.trim()) return err("command must be non-empty."); const timeoutMs=p.timeoutMs??DEFAULT_TIMEOUT_MS; counter++; const id=`job-${counter}`;
  const state=createJobState();
  let child: ReturnType<typeof spawn>; try { child=spawnProcess(command,{cwd:p.cwd||ctx.cwd,shell:"/bin/sh",detached:true,stdio:["ignore","pipe","pipe"]}); } catch(e) {
   const j:Job={id,command,cwd:p.cwd||ctx.cwd,child:undefined as any,ring:new JobRing(BUFFER_CAP),startTime:Date.now(),state,waiters:[],owner:ownerId,notified:false,read:false}; jobs.set(id,j);
   const reason=String(e); j.ring.append(`\n[spawn error: ${reason}]\n`); finish(j,"failed",null,reason,pi); return err(`Failed to spawn: ${reason}`);
  }
  const j:Job={id,command,cwd:p.cwd||ctx.cwd,child,ring:new JobRing(BUFFER_CAP),startTime:Date.now(),state,waiters:[],owner:ownerId,notified:false,read:false}; jobs.set(id,j);
  child.stdout?.on("data",d=>j.ring.append(d)); child.stderr?.on("data",d=>j.ring.append(d));
  child.on("error",e=>{ j.ring.append(`\n[spawn error: ${e.message}]\n`); finish(j,"failed",null,e.message,pi); });
  // Child close follows stdout/stderr data delivery, so settled output includes the final bytes.
  child.on("close",code=>finish(j,j.state.status==="stopping"?"killed":"completed",code,j.state.reason,pi));
  if(timeoutMs>0) j.timeout=setTimeout(()=>{ j.ring.append(`\n[timeout after ${timeoutMs}ms]\n`); kill(j,"timeout"); },timeoutMs); child.unref();
  return ok(`Started ${id}: ${command}`,{jobId:id,status:"running"});
 }});
 pi.registerTool({name:"job_output",label:"Job Output",description:"Read buffered output and status. Reads are non-consuming.",parameters:Type.Object({jobId:Type.String(),waitMs:Type.Optional(Type.Number()),outputLimitBytes:Type.Optional(Type.Number())}),async execute(_i,p){const j=jobs.get(String(p.jobId));if(!j)return err(`Unknown jobId: ${p.jobId}`);const ms=Math.min(60000,Math.max(0,p.waitMs??0));if(ms&&!isSettled(j.state))await wait(j,ms);j.read=true;let text=j.ring.read().text;const cap=Math.max(0,p.outputLimitBytes??4000);const b=Buffer.from(text);const truncated=b.length>cap;if(truncated)text=b.subarray(b.length-cap).toString("utf8");return ok(`${j.id} ${status(j)}${j.state.exitCode===null?"":` exit=${j.state.exitCode}`}\n${text}${truncated?"\n[output truncated]":""}`,{jobId:j.id,status:status(j),exitCode:j.state.exitCode,reason:j.state.reason,output:text,truncated});}});
 pi.registerTool({name:"job_list",label:"Job List",description:"List jobs, distinguishing running/pending jobs from settled jobs.",parameters:Type.Object({}),async execute(){const list=[...jobs.values()];return ok(list.map(j=>`${j.id} ${status(j)}${j.state.exitCode===null?"":` exit=${j.state.exitCode}`} ${j.command}`).join("\n")||"No jobs.",{jobs:list.map(j=>({jobId:j.id,status:status(j),exitCode:j.state.exitCode,reason:j.state.reason,command:j.command}))});}});
 pi.registerTool({name:"job_kill",label:"Job Kill",description:"Request cancellation of a pending job (whole process group receives SIGKILL).",parameters:Type.Object({jobId:Type.String()}),async execute(_i,p){const j=jobs.get(String(p.jobId));if(!j)return err(`Unknown jobId: ${p.jobId}`);if(isSettled(j.state))return ok(`${j.id} already settled (${status(j)}).`,{status:status(j)});kill(j,"cancelled by user");return ok(`Cancellation requested for ${j.id}; awaiting settlement.`,{status:status(j)});}});
}
