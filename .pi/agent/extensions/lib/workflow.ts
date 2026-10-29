export interface WorkflowResult {
  worker: string;
  task: string;
  ok: boolean;
  output: string;
  error?: string;
}

export const OUTPUT_LIMIT = 12_000;
export const CAPTURE_LIMIT = 64_000;
export const CAPTURE_MARKER = "\n...[output truncated]...\n";
export const RALPH_MAX_HANDOFF_CHARS = 16_384;

export function renderResult(result: WorkflowResult): string {
  if (result.ok) return result.output.trim() || "ERROR: worker exited successfully with empty output";
  return `ERROR: ${result.error ?? result.output ?? "Worker failed without diagnostic output."}`;
}

/** Bounded head+tail capture. Retains a balanced diagnostic window and marks loss. */
export class BoundedCapture {
  private head = "";
  private tail = "";
  private total = 0;
  readonly limit: number;
  constructor(limit = CAPTURE_LIMIT) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("capture limit must be a positive integer");
    this.limit = limit;
  }
  append(chunk: string | Uint8Array): void {
    let text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    this.total += text.length;
    if (this.total <= this.limit) { this.tail += text; return; }
    const headLimit = Math.ceil(this.limit / 2);
    const tailLimit = Math.floor(this.limit / 2);
    if (this.head.length < headLimit) {
      const needed = headLimit - this.head.length;
      this.head += text.slice(0, needed);
      text = text.slice(needed);
    }
    this.tail = (this.tail + text).slice(-tailLimit);
  }
  toString(): string {
    if (this.total <= this.limit) return this.tail;
    return `${this.head.slice(0, Math.ceil(this.limit / 2))}${CAPTURE_MARKER}${this.tail}`;
  }
}

export interface RalphReport {
  status: "continue" | "complete" | "blocked";
  summary: string;
  evidence?: string;
  next?: string;
  blocker?: string;
}

export function parseRalphReport(output: string): RalphReport | null {
  const fenced = output.match(/```report-json\s*([\s\S]*?)\s*```/);
  const raw = fenced?.[1] ?? output.match(/\{[\s\S]*?"status"[\s\S]*?\}/)?.[0];
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    const status = p.status;
    if (!["continue", "complete", "blocked"].includes(String(status))) return null;
    if (typeof p.summary !== "string" || !p.summary.trim()) return null;
    if (status === "continue" && (typeof p.next !== "string" || !p.next.trim())) return null;
    if (status === "blocked" && (typeof p.blocker !== "string" || !p.blocker.trim())) return null;
    const report: RalphReport = { status: status as RalphReport["status"], summary: p.summary };
    for (const key of ["evidence", "next", "blocker"] as const) if (typeof p[key] === "string") report[key] = p[key] as string;
    return boundRalphReport(report);
  } catch { return null; }
}

export function boundRalphReport(report: RalphReport): RalphReport {
  const limit = Math.floor(RALPH_MAX_HANDOFF_CHARS / 4);
  return {
    status: report.status,
    summary: report.summary.slice(0, limit),
    ...(report.evidence ? { evidence: report.evidence.slice(0, limit) } : {}),
    ...(report.next ? { next: report.next.slice(0, limit) } : {}),
    ...(report.blocker ? { blocker: report.blocker.slice(0, limit) } : {}),
  };
}

export function formatRalphHandoff(report: RalphReport, round: number): string {
  const text = [`Round ${round} report (status: ${report.status}):`, `Summary: ${report.summary || "(none)"}`, `Evidence: ${report.evidence || "(none)"}`, `Next steps: ${report.next || "(none)"}`, `Blocker: ${report.blocker || "(none)"}`].join("\n");
  return text.length <= RALPH_MAX_HANDOFF_CHARS ? text : text.slice(0, RALPH_MAX_HANDOFF_CHARS - 16) + "\n...[truncated]";
}

export function validWorkflowMode(value: unknown): value is "parallel" | "serial" | "pipeline" {
  return value === "parallel" || value === "serial" || value === "pipeline";
}

export function normalizeWorkflowMode(mode: string): "parallel" | "serial" {
  return mode === "parallel" ? "parallel" : "serial";
}

export function validateWorkflowLimits(phases: Array<{ workers: unknown[] }>, concurrency: number, maxWorkers = 32, maxItems = 64): void {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error("concurrency must be an integer from 1 to 16");
  if (phases.some(p => !Array.isArray(p.workers)) || phases.reduce((n, p) => n + p.workers.length, 0) > maxWorkers) throw new Error(`workflow exceeds ${maxWorkers} total workers`);
  if (phases.some(p => p.workers.length > maxItems)) throw new Error(`phase exceeds ${maxItems} items`);
}
