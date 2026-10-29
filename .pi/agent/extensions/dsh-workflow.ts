/**
 * dsh-workflow — multi-agent delegation, ported from DeepSeek Harness
 * `@deepseek-ai/dsh-tool-workflow` + `@deepseek-ai/dsh-tool-subagent`.
 *
 * pi SHIPS WITHOUT subagents (its README says so explicitly). This extension
 * adds them, with the DSH orchestration shape:
 *
 *   - `subagent`  — spawn an ISOLATED pi process (fresh context, no parent
 *     contamination) with a standalone prompt; return its final output. This is
 *     the same isolation pi's own example uses (separate `--mode json`
 *     process), which is what makes parallel workflows possible without
 *     blowing up the parent context.
 *   - `workflow`  — fan out many subagent jobs across named PHASES. Both
 *     `pipeline` and `parallel` execute phases as ordered barriers: every
 *     worker in a phase finishes before the next phase begins. Per-item
 *     stage progression is deferred pending an item-to-stage schema. Isolated
 *     contexts mean a big audit over N files does not re-read the parent
 *     conversation into each worker.
 *
 * Efficiency property preserved: each worker is given a STANDALONE prompt (not
 * the parent's transcript), matching DSH's `inheritsParentContext: false`. The
 * parent only pays for the small aggregate result, not N full transcript
 * replays.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { BoundedCapture, renderResult, parseRalphReport, formatRalphHandoff, validateWorkflowLimits, validWorkflowMode, normalizeWorkflowMode, type WorkflowResult as WorkerResult, type RalphReport } from "./lib/workflow.ts";

const PER_WORKER_CAP = 12_000;
let spawnProcess: typeof spawn = spawn;

/** Replace the child-process boundary in isolated tests; production defaults to node spawn. */
export function __setSpawnForTest(implementation?: typeof spawn): void {
  spawnProcess = implementation ?? spawn;
}
const DEFAULT_CONCURRENCY = 4;
const MAX_WORKERS = 32;
const MAX_ITEMS_PER_PHASE = 64;

/** Resolve the path to the `pi`/`pi-coding-agent` executable for spawning. */
function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }
  return { command: "pi", args };
}

async function writePromptToTemp(workerName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-dsh-worker-"));
  const safe = workerName.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tmpDir, `prompt-${safe}.md`);
  await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
  return { dir: tmpDir, filePath };
}

/** Run one isolated pi worker; resolves the final text output. */
async function runWorker(
  workerName: string,
  task: string,
  cwd: string,
  signal: AbortSignal | undefined,
  model?: import("@earendil-works/pi-ai").Model<any>,
): Promise<WorkerResult> {
  try {
    const { dir: tmpDir, filePath: promptPath } = await writePromptToTemp(workerName, task);
    // Match pi's canonical subagent spawn: the isolated prompt is delivered as
    // an --append-system-prompt file (NOT -f), and the task is the positional
    // message. -f is not a pi flag and breaks every worker.
    const args = [
      "--mode", "json", "-p", "--no-session",
      "--append-system-prompt", promptPath,
      `Task: ${task}`,
    ];
    // Forward the parent's model + provider so workers run on the SAME route
    // (e.g. nube DeepSeek). Without both flags, children fall back to pi's
    // default model (orcarouter/auto here, which has no credits -> 403), and a
    // bare --model id is ambiguous when the same id exists on many providers.
    // NOTE: append AFTER "--mode json" — splicing mid-array splits that flag
    // pair and pi misparses the whole command line.
    if (model?.id) args.push("--provider", String(model.provider), "--model", model.id);
    const { command, args: cmdArgs } = getPiInvocation(args);

    const { output, ok } = await new Promise<{ output: string; ok: boolean }>((resolve, reject) => {
      const child = spawnProcess(command, cmdArgs, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdoutCapture = new BoundedCapture();
      const stderrCapture = new BoundedCapture();
      child.stdout?.on("data", (d: Buffer) => stdoutCapture.append(d));
      child.stderr?.on("data", (d: Buffer) => stderrCapture.append(d));
      const onAbort = () => child.kill("SIGINT");
      signal?.addEventListener("abort", onAbort, { once: true });
      child.on("error", reject);
      child.on("close", (code) => {
        signal?.removeEventListener("abort", onAbort);
        if (signal?.aborted) return resolve({ output: "(aborted)", ok: false });
        // pi --mode json emits JSONL events; extract the assistant's final text
        // from message_end agents (same parsing pi's subagent example uses).
        const stdout = stdoutCapture.toString();
        const stderr = stderrCapture.toString();
        const texts: string[] = [];
        for (const line of stdout.split("\n")) {
          if (!line.trim()) continue;
          let event: any;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event?.type === "message_end" && event?.message) {
            const msg = event.message;
            if (event.subtype === "agent" || msg?.role === "assistant") {
              const parts = (msg.content ?? [])
                .filter((c: any) => c?.type === "text")
                .map((c: any) => (c.text ?? "").trim());
              if (parts.length) texts.push(parts.join("\n"));
            }
          }
        }
        const finalText = texts.join("\n").trim();
        if (code === 0 && finalText) return resolve({ output: finalText.slice(0, PER_WORKER_CAP), ok: true });
        const errText = [finalText, stderr.trim()].filter(Boolean).join("\n").slice(0, PER_WORKER_CAP);
        return resolve({ output: errText || `Worker exited with code ${code ?? "unknown"}.`, ok: false });
      });
    });

    const result = { worker: workerName, task, ok, output: output.slice(0, PER_WORKER_CAP), ...(!ok ? { error: output || "Worker failed without diagnostic output." } : {}) };
    // The prompt file was only needed while the child was alive; clean up now.
    fs.rm(tmpDir, { recursive: true, force: true }, () => {});
    return result;
  } catch (error) {
    return {
      worker: workerName,
      task,
      ok: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function mapLimit<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<WorkerResult>,
): Promise<WorkerResult[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: WorkerResult[] = new Array(items.length);
  let next = 0;
  const workers = new Array(limit).fill(null).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

type WorkerSpec = { name: string; task: string };

/**
 * ralph — fresh-agent iterative loop, ported from DeepSeek Harness
 * `@deepseek-ai/dsh-tool-ralph`.
 *
 * Gives one immutable objective to a sequence of fresh isolated children.
 * Each child receives ONLY the objective, its round/cap, a
 * shared-workspace-as-memory instruction, and the previous structured handoff
 * — never the parent conversation or prior child sessions. Reports carry
 * `status: continue | complete | blocked` plus summary/evidence/next/blocker.
 *
 * Deviation from upstream: upstream defaults `maxRounds` to 256 (in-process
 * children). pi children are full subprocesses, so the pi default is 8 with
 * the same 256 ceiling; override per call when you truly want a long loop.
 */
const RALPH_DEFAULT_MAX_ROUNDS = 8;
const RALPH_MAX_ROUNDS_CEILING = 256;
const RALPH_MAX_HANDOFF_CHARS = 16384;

/* Ralph report parsing and formatting are covered in lib/workflow.ts. */
function parseRalphReportOld(output: string): RalphReport | null {
  // Prefer an explicit fenced report block emitted per the child instruction.
  const fenced = output.match(/```report-json\s*([\s\S]*?)\s*```/);
  const candidates: string[] = [];
  if (fenced?.[1]) candidates.push(fenced[1]);
  // Fall back to any JSON object in the output that carries a status field.
  const brace = output.match(/\{[\s\S]*?"status"[\s\S]*?\}/);
  if (brace?.[0]) candidates.push(brace[0]);
  for (const raw of candidates) {
    try {
      const parsed = JSON.parse(raw) as Partial<RalphReport>;
      const status = String(parsed.status ?? '').toLowerCase();
      if (status === 'continue' || status === 'complete' || status === 'blocked') {
        const str = (v: unknown): string => (typeof v === 'string' ? v : '');
        return {
          status,
          summary: str(parsed.summary).slice(0, RALPH_MAX_HANDOFF_CHARS),
          evidence: str(parsed.evidence).slice(0, RALPH_MAX_HANDOFF_CHARS),
          next: str(parsed.next).slice(0, RALPH_MAX_HANDOFF_CHARS),
          blocker: str(parsed.blocker).slice(0, RALPH_MAX_HANDOFF_CHARS),
        };
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

export default function dshWorkflow(pi: ExtensionAPI): void {
  const runWorkers = async (
    specs: WorkerSpec[],
    cwd: string,
    concurrency: number,
    signal: AbortSignal | undefined,
    model?: import("@earendil-works/pi-ai").Model<any>,
  ): Promise<WorkerResult[]> => {
    return mapLimit(specs, concurrency, (spec) => runWorker(spec.name, spec.task, cwd, signal, model));
  };

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Spawn one isolated pi agent with a standalone prompt (fresh context) and return its final output. Use for a single delegation so the parent context stays clean.",
    parameters: Type.Object({
      task: Type.String({ description: "Self-contained instructions. Do not reference the parent conversation." }),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const result = await runWorker("agent", params.task, ctx.cwd, signal, ctx.model);
      return {
        content: [
          {
            type: "text",
            text: result.ok
              ? `subagent output:\n${renderResult(result)}`
              : renderResult(result),
          },
        ],
        details: result,
      } as AgentToolResult<WorkerResult>;
    },
  });

  pi.registerTool({
    name: "workflow",
    label: "Workflow",
    description:
      "Fan out many isolated subagents in phases and return each phase's aggregate. For large multi-agent work. Use subagent for one or two delegations instead.",
    parameters: Type.Object({
      name: Type.String({ description: "Short workflow name." }),
      concurrency: Type.Optional(Type.Number({ description: "Worker concurrency (1-16, default 4). Total worker cap 32; maximum 64 workers per phase." })),
      phases: Type.Array(
        Type.Object({
          title: Type.String({ description: "Phase label." }),
          mode: Type.String({ description: "Execution mode: 'parallel' or 'serial' ('pipeline' accepted as deprecated alias for serial). Both are ordered phase barriers; serial runs one worker at a time." }),
          workers: Type.Array(
            Type.Object({
              name: Type.String(),
              task: Type.String({ description: "Standalone, self-contained task for this worker." }),
            }),
          ),
        }),
        { description: "Ordered phases; all workers in each phase finish before the next phase. 'pipeline' is a deprecated alias for serial. No schema-constrained CLI output flag; continuation is deferred; background execution is not supported." },
      ),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const concurrency = params.concurrency ?? DEFAULT_CONCURRENCY;
      for (const p of params.phases) if (!validWorkflowMode(p.mode)) throw new Error(`Invalid mode: ${p.mode}`);
      validateWorkflowLimits(params.phases, concurrency, MAX_WORKERS, MAX_ITEMS_PER_PHASE);
      const all: WorkerResult[] = [];
      let phase = 0;
      for (const phaseDef of params.phases) {
        phase += 1;
        onUpdate?.({
          content: [
            {
              type: "text",
              text: `[phase ${phase}/${params.phases.length}] ${phaseDef.title} — ${phaseDef.workers.length} worker(s)`,
            },
          ],
          details: {},
        } as AgentToolResult<unknown>);
        const phaseConcurrency = normalizeWorkflowMode(phaseDef.mode) === "serial" ? 1 : concurrency;
        const results = await runWorkers(phaseDef.workers, ctx.cwd, phaseConcurrency, signal, ctx.model);
        all.push(...results);
      }
      const okCount = all.filter((r) => r.ok).length;
      const summary = all
        .map((r) => `## ${r.worker}\n${renderResult(r)}`)
        .join("\n\n");
      return {
        content: [
          {
            type: "text",
            text: `workflow "${params.name}" done: ${okCount}/${all.length} workers OK.\n\n${summary.slice(0, PER_WORKER_CAP * 4)}`,
          },
        ],
        details: { workers: all },
      } as AgentToolResult<unknown>;
    },
  });

  pi.registerTool({
    name: "ralph",
    label: "Ralph",
    description:
      "Run a fresh-agent iterative loop on one immutable objective until a child reports complete/blocked or the round cap is hit. Each round is a fresh isolated subagent; the shared workspace is durable memory. Use ONLY when explicitly asked for a Ralph loop.",
    parameters: Type.Object({
      objective: Type.String({ description: "Immutable objective for every round. Do not reference the parent conversation." }),
      maxRounds: Type.Optional(Type.Number({ description: `Round cap for this run (default ${RALPH_DEFAULT_MAX_ROUNDS}, ceiling ${RALPH_MAX_ROUNDS_CEILING}).` })),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const cap = Math.max(
        1,
        Math.min(
          Math.floor(params.maxRounds ?? RALPH_DEFAULT_MAX_ROUNDS),
          RALPH_MAX_ROUNDS_CEILING,
        ),
      );
      let handoff: RalphReport | null = null;
      let roundsStarted = 0;
      let terminal: 'complete' | 'blocked' | 'budget-limited' = 'budget-limited';
      for (let round = 1; round <= cap; round += 1) {
        if (signal?.aborted) break;
        roundsStarted = round;
        onUpdate?.({
          content: [{ type: "text", text: `[ralph round ${round}/${cap}] starting fresh child` }],
          details: {},
        } as AgentToolResult<unknown>);
        const childTask = [
          `Objective (immutable, do not reinterpret): ${params.objective}`,
          `This is Ralph round ${round} of ${cap}. You are a fresh agent with no prior context.`,
          `The shared workspace (cwd: ${ctx.cwd}) is durable memory: read state from files, write durable state back to files.`,
          handoff ? `Previous round handoff:\n${formatRalphHandoff(handoff, round - 1)}` : `No previous handoff (first round).`,
          `When done, emit a fenced report block EXACTLY like:`,
          '```report-json',
          '{"status": "continue | complete | blocked", "summary": "...", "evidence": "...", "next": "...", "blocker": "..."}',
          '```',
          `Use status "complete" only when the objective is fully achieved, "blocked" when no further progress is possible, else "continue".`,
        ].join('\n');
        const result = await runWorker(`ralph-round-${round}`, childTask, ctx.cwd, signal, ctx.model);
        if (!result.ok) {
          // Upstream does not retry a failed round; carry the last handoff.
          terminal = 'round-failed';
          handoff = handoff ?? {
            status: 'blocked',
            summary: `Round ${round} failed: ${result.error || result.output}`.slice(0, RALPH_MAX_HANDOFF_CHARS),
            evidence: '',
            next: '',
            blocker: result.error || result.output,
          };
          break;
        }
        const report = parseRalphReport(result.output);
        if (!report) {
          terminal = 'round-failed';
          // Keep the last valid handoff intact. Parse diagnostics belong in
          // the terminal result, not in the structured handoff.
          break;
        }
        handoff = report;
        if (report.status === 'complete' || report.status === 'blocked') {
          terminal = report.status;
          break;
        }
      }
      const last = handoff
        ? formatRalphHandoff(handoff, roundsStarted)
        : '(no rounds completed)';
      const fullText = `ralph done: ${terminal} after ${roundsStarted}/${cap} round(s).\n\n${last}`;
      const marker = '\n...[truncated]';
      const text =
        fullText.length > RALPH_MAX_HANDOFF_CHARS
          ? fullText.slice(0, RALPH_MAX_HANDOFF_CHARS - marker.length) + marker
          : fullText;
      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
        details: { terminal, roundsStarted, cap, handoff, ...(terminal === 'round-failed' && handoff ? { failure: 'Unparseable report in round output.' } : {}) },
      } as AgentToolResult<unknown>;
    },
  });
}
