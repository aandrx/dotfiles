export type JobStatus = "running" | "stopping" | "completed" | "killed" | "failed";
export interface JobState { status: JobStatus; exitCode: number | null; reason?: string; }
export function createJobState(): JobState { return { status: "running", exitCode: null }; }
export function requestStop(state: JobState, reason = "cancelled"): boolean {
  if (state.status !== "running") return false;
  state.status = "stopping"; state.reason = reason; return true;
}
export function settleJob(state: JobState, status: Exclude<JobStatus, "running" | "stopping">, exitCode: number | null, reason?: string): boolean {
  if (state.status === "completed" || state.status === "killed" || state.status === "failed") return false;
  state.status = status; state.exitCode = exitCode; if (reason) state.reason = reason; return true;
}
export function isSettled(state: JobState): boolean { return state.status === "completed" || state.status === "killed" || state.status === "failed"; }
