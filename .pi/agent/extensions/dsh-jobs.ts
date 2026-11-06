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

/** When a settled job wakes the owning session. */
type NotifyMode = "failure" | "always" | "never";

interface Job { id: string; command: string; description?: string; notify: NotifyMode; cwd: string; child: ReturnType<typeof spawn>; ring: JobRing; startTime: number; settledAt?: number; state: JobState; timeout?: ReturnType<typeof setTimeout>; waiters: Array<() => void>; owner?: string; reported: boolean; read: boolean; }
const MAX_RUNNING = 4, BUFFER_CAP = 1024 * 1024, DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
// Successful batches wake at most this many times per session; batches with a failure always wake.
const DEFAULT_WAKE_CAP = 3;
const NOTICE_COMMAND_CHARS = 120, NOTICE_DESCRIPTION_CHARS = 100, BATCH_TAIL_CHARS = 120;
let counter = 0, ownerId: string | undefined, ownerCtx: any, wakeCount = 0;
const jobs = new Map<string, Job>();
// Settled jobs waiting for the last running job, so results report once as a batch.
let pending: Job[] = [];
function ok(text: string, details: unknown = {}) { return { content: [{ type: "text" as const, text }], details }; }
function err(text: string) { return { content: [{ type: "text" as const, text: `Error: ${text}` }], isError: true }; }
function status(j: Job) { return j.state.status; }
function clip(text: string, limit: number): string { const flat = text.replace(/\s+/g, " ").trim(); return flat.length > limit ? `${flat.slice(0, limit - 3)}...` : flat; }
function duration(ms: number): string { return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`; }
function lastLine(text: string): string { const lines = text.split("\n").map(l => l.trim()).filter(Boolean); return lines.length ? clip(lines[lines.length - 1], BATCH_TAIL_CHARS) : ""; }
function succeeded(j: Job): boolean { return j.state.status === "completed" && j.state.exitCode === 0; }
/** Jobs still running for this owner; the batch waits until this reaches zero. */
function outstanding(): number { let n = 0; for (const j of jobs.values()) if (!isSettled(j.state) && j.owner === ownerId) n++; return n; }
/** One rundown for the whole batch: what ran, what failed, and where to look next. */
function batchNotice(batch: Job[], failed: number): string {
 const head = batch.length === 1
  ? `1 job settled${failed ? " (failed)" : ""}`
  : `all ${batch.length} jobs settled${failed ? ` (${failed} failed)` : ""}`;
 const lines = [head];
 // Order by job number so the rundown reads in launch order, not settle order.
 for (const j of [...batch].sort((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4)))) {
  const label = succeeded(j) ? "completed" : j.state.status === "completed" ? "failed" : status(j);
  const code = j.state.exitCode === null ? "" : ` exit=${j.state.exitCode}`;
  const desc = j.description ? ` ${clip(j.description, NOTICE_DESCRIPTION_CHARS)}` : "";
  const tail = lastLine(j.ring.read().text);
  lines.push(`${j.id} ${label}${code} (${duration((j.settledAt ?? Date.now()) - j.startTime)})${desc}${tail ? `: ${tail}` : ""}`);
 }
 lines.push(`Call job_output <id> for full output.`);
 return lines.join("\n");
}
/** Release the batch. A batch containing a failure interrupts; a clean batch waits for the next turn. */
function flush(pi: ExtensionAPI) {
 if (!pending.length || !ownerCtx) return;
 const batch = pending; pending = [];
 // A wave of silent successes produces no message at all.
 if (!batch.some(j => !succeeded(j) || j.notify === "always")) return;
 const failed = batch.filter(j => !succeeded(j)).length;
 const failure = failed > 0;
 if (!failure) { const cap = ownerCtx.__jobWakeCap ?? DEFAULT_WAKE_CAP; if (wakeCount >= cap) return; wakeCount++; }
 try {
  pi.sendMessage(
   { customType: "dsh-job-complete", content: batchNotice(batch, failed), display: failure },
   failure ? { triggerTurn: true, deliverAs: "followUp" } : { deliverAs: "nextTurn" },
  );
 } catch {}
}
function finish(j: Job, result: "completed" | "killed" | "failed", code: number | null, reason?: string, pi?: ExtensionAPI) {
 if (!settleJob(j.state,result,code,reason)) return;
 if (j.timeout) clearTimeout(j.timeout); j.timeout=undefined;
 j.settledAt = Date.now();
 for (const resolve of j.waiters.splice(0)) resolve();
 if (j.notify === "never") { j.reported = true; return; }
 if (j.read || j.reported || !pi || j.owner !== ownerId || !ownerCtx) return;
 j.reported = true;
 // Every settled job joins the batch so the rundown is complete; a wave with no
 // failure and no notify=always is dropped at flush instead of reported.
 pending.push(j);
 // Hold the batch until nothing is still running, so results arrive as one synthesis.
 if (outstanding() > 0) return;
 flush(pi);
}
function kill(j: Job, reason: string) { if (!requestStop(j.state,reason)) return false; try { if (j.child.pid !== undefined) process.kill(-j.child.pid,"SIGKILL"); else j.child.kill("SIGKILL"); } catch { try { j.child.kill("SIGKILL"); } catch {} } return true; }
function wait(j: Job, ms: number) { if (isSettled(j.state)) return Promise.resolve(); return new Promise<void>(resolve => { const t=setTimeout(()=>{ j.waiters=j.waiters.filter(x=>x!==done); resolve(); },ms); const done=()=>{clearTimeout(t);resolve();}; j.waiters.push(done); }); }
export default function dshJobs(pi: ExtensionAPI): void {
 pi.on("session_start", (event, ctx) => { ownerId=ctx.sessionManager.getSessionId?.() ?? String((event as any).sessionId ?? "session"); ownerCtx=ctx; wakeCount=0; pending=[]; if(event.reason === "new" || event.reason === "resume" || event.reason === "fork") { for(const j of jobs.values()) if(!isSettled(j.state)) kill(j,"session replaced"); jobs.clear(); } });
 pi.on("session_shutdown", () => { for(const j of jobs.values()) if(!isSettled(j.state)) kill(j,"session shutdown"); ownerId=undefined; ownerCtx=undefined; pending=[]; });
 pi.on("session_before_switch",()=>{}); pi.on("before_fork",()=>{});
 pi.registerTool({ name:"job_start", label:"Job Start", description:"Start a detached background shell command. Returns immediately. Pass description so the final batch notice is self-describing. Results report once, when the last job settles; a successful job alone sends nothing, so never promise a report on it unless notify is always.", parameters:Type.Object({command:Type.String(),cwd:Type.Optional(Type.String()),timeoutMs:Type.Optional(Type.Number()),description:Type.Optional(Type.String()),notify:Type.Optional(Type.Union([Type.Literal("failure"),Type.Literal("always"),Type.Literal("never")]))}), async execute(_id,p,_s,_u,ctx){
  if([...jobs.values()].filter(j=>!isSettled(j.state)).length>=MAX_RUNNING) return err(`Job limit reached: ${MAX_RUNNING} jobs already running.`);
  const command=String(p.command??""); if(!command.trim()) return err("command must be non-empty."); const timeoutMs=p.timeoutMs??DEFAULT_TIMEOUT_MS; counter++; const id=`job-${counter}`;
  const description=p.description?String(p.description):undefined; const notify=(p.notify??"failure") as NotifyMode;
  const state=createJobState();
  let child: ReturnType<typeof spawn>; try { child=spawnProcess(command,{cwd:p.cwd||ctx.cwd,shell:"/bin/sh",detached:true,stdio:["ignore","pipe","pipe"]}); } catch(e) {
   const j:Job={id,command,description,notify,cwd:p.cwd||ctx.cwd,child:undefined as any,ring:new JobRing(BUFFER_CAP),startTime:Date.now(),state,waiters:[],owner:ownerId,reported:false,read:false}; jobs.set(id,j);
   const reason=String(e); j.ring.append(`\n[spawn error: ${reason}]\n`); finish(j,"failed",null,reason,pi); return err(`Failed to spawn: ${reason}`);
  }
  const j:Job={id,command,description,notify,cwd:p.cwd||ctx.cwd,child,ring:new JobRing(BUFFER_CAP),startTime:Date.now(),state,waiters:[],owner:ownerId,reported:false,read:false}; jobs.set(id,j);
  child.stdout?.on("data",d=>j.ring.append(d)); child.stderr?.on("data",d=>j.ring.append(d));
  child.on("error",e=>{ j.ring.append(`\n[spawn error: ${e.message}]\n`); finish(j,"failed",null,e.message,pi); });
  // Child close follows stdout/stderr data delivery, so settled output includes the final bytes.
  child.on("close",code=>finish(j,j.state.status==="stopping"?"killed":"completed",code,j.state.reason,pi));
  if(timeoutMs>0) j.timeout=setTimeout(()=>{ j.ring.append(`\n[timeout after ${timeoutMs}ms]\n`); kill(j,"timeout"); },timeoutMs); child.unref();
  return ok(`Started ${id}: ${command}`,{jobId:id,status:"running",description,notify});
 }});
 pi.registerTool({name:"job_output",label:"Job Output",description:"Read buffered output and status. Reads are non-consuming.",parameters:Type.Object({jobId:Type.String(),waitMs:Type.Optional(Type.Number()),outputLimitBytes:Type.Optional(Type.Number())}),async execute(_i,p){const j=jobs.get(String(p.jobId));if(!j)return err(`Unknown jobId: ${p.jobId}`);const ms=Math.min(60000,Math.max(0,p.waitMs??0));if(ms&&!isSettled(j.state))await wait(j,ms);j.read=true;let text=j.ring.read().text;const cap=Math.max(0,p.outputLimitBytes??4000);const b=Buffer.from(text);const truncated=b.length>cap;if(truncated)text=b.subarray(b.length-cap).toString("utf8");return ok(`${j.id} ${status(j)}${j.state.exitCode===null?"":` exit=${j.state.exitCode}`}\n${text}${truncated?"\n[output truncated]":""}`,{jobId:j.id,status:status(j),exitCode:j.state.exitCode,reason:j.state.reason,output:text,truncated});}});
 pi.registerTool({name:"job_list",label:"Job List",description:"List jobs, distinguishing running/pending jobs from settled jobs.",parameters:Type.Object({}),async execute(){const list=[...jobs.values()];return ok(list.map(j=>`${j.id} ${status(j)}${j.state.exitCode===null?"":` exit=${j.state.exitCode}`} ${j.command}${j.description?` (${clip(j.description,NOTICE_DESCRIPTION_CHARS)})`:""}`).join("\n")||"No jobs.",{jobs:list.map(j=>({jobId:j.id,status:status(j),exitCode:j.state.exitCode,reason:j.state.reason,command:j.command,description:j.description,notify:j.notify}))});}});
 pi.registerTool({name:"job_kill",label:"Job Kill",description:"Request cancellation of a pending job (whole process group receives SIGKILL).",parameters:Type.Object({jobId:Type.String()}),async execute(_i,p){const j=jobs.get(String(p.jobId));if(!j)return err(`Unknown jobId: ${p.jobId}`);if(isSettled(j.state))return ok(`${j.id} already settled (${status(j)}).`,{status:status(j)});kill(j,"cancelled by user");return ok(`Cancellation requested for ${j.id}; awaiting settlement.`,{status:status(j)});}});
}
