import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { BoundedCapture, renderResult, parseRalphReport, formatRalphHandoff, validateWorkflowLimits, validWorkflowMode, normalizeWorkflowMode } from "../lib/workflow.ts";
import dshWorkflow from "../dsh-workflow.ts";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

export default function noop(): void {}
const isMain = !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  test("harness registers documented workflow limits and subagent schema", () => {
    const tools: any[] = [];
    dshWorkflow({ registerTool: (tool: any) => tools.push(tool) } as any);
    const workflow = tools.find((t) => t.name === "workflow");
    const subagent = tools.find((t) => t.name === "subagent");
    assert.ok(workflow?.parameters && workflow.description);
    assert.ok(subagent?.parameters && subagent.description);
    const wording = `${workflow.description} ${JSON.stringify(workflow.parameters)}`;
    assert.match(wording, /schema-constrained CLI output/i);
    assert.match(wording, /continuation is deferred/i);
    assert.match(wording, /background execution is not supported/i);
  });

  test("harness workflow enforces phase barriers and concurrency with mocked spawn", async () => {
    let inFlight = 0, peak = 0, spawnCalls = 0;
    const completions: string[] = [];
    let completionsAtLaterSpawn = -1;
    const workflowModule = await import("../dsh-workflow.ts");
    (workflowModule as any).__setSpawnForTest((...args: any[]) => {
      spawnCalls++;
      inFlight++; peak = Math.max(peak, inFlight);
      const taskArg = (args[1] as string[]).find((a) => a.startsWith("Task: ")) ?? "";
      const task = taskArg.slice("Task: ".length);
      if (task === "later") completionsAtLaterSpawn = completions.length;
      const child: any = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      setImmediate(() => {
        child.stdout.end(JSON.stringify({ type: "message_end", subtype: "agent", message: { content: [{ type: "text", text: "ok" }] } }) + "\n");
        child.stderr.end(); inFlight--;
        completions.push(task);
        child.emit("close", 0);
      });
      return child;
    });
    const tools: any[] = [];
    dshWorkflow({ registerTool: (tool: any) => tools.push(tool) } as any);
    const workflow = tools.find((tool) => tool.name === "workflow");
    await workflow.execute("id", { name: "test", concurrency: 2, phases: [
      { title: "one", mode: "parallel", workers: ["a", "b", "c", "d"].map(name => ({ name, task: name })) },
      { title: "two", mode: "pipeline", workers: [{ name: "later", task: "later" }] },
    ] }, undefined, undefined, { cwd: process.cwd() });
    assert.ok(peak <= 2, `concurrency cap respected (peak ${peak})`);
    assert.ok(peak >= 1);
    assert.deepEqual([...completions].sort(), ["a", "b", "c", "d", "later"]);
    assert.equal(completionsAtLaterSpawn, 4);
    assert.equal(spawnCalls, 5);
    (workflowModule as any).__setSpawnForTest();
  });

  test("serial phase never exceeds one in-flight mocked worker", async () => {
    let inFlight = 0, peak = 0;
    const workflowModule = await import("../dsh-workflow.ts");
    (workflowModule as any).__setSpawnForTest((..._args: any[]) => {
      inFlight++; peak = Math.max(peak, inFlight);
      const child: any = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      setImmediate(() => {
        child.stdout.end(JSON.stringify({ type: "message_end", subtype: "agent", message: { content: [{ type: "text", text: "ok" }] } }) + "\\n");
        child.stderr.end(); inFlight--; child.emit("close", 0);
      });
      return child;
    });
    try {
      const tools: any[] = []; dshWorkflow({ registerTool: (tool: any) => tools.push(tool) } as any);
      await tools.find((tool) => tool.name === "workflow").execute("id", { name: "serial", concurrency: 3,
        phases: [{ title: "serial", mode: "serial", workers: ["a", "b", "c"].map(name => ({ name, task: name })) }] }, undefined, undefined, { cwd: process.cwd() });
      assert.equal(peak, 1);
    } finally { (workflowModule as any).__setSpawnForTest(); }
  });

  test("invalid workflow config is rejected before mocked spawn", async () => {
    let spawnCalls = 0;
    const workflowModule = await import("../dsh-workflow.ts");
    (workflowModule as any).__setSpawnForTest(() => { spawnCalls++; throw new Error("spawned"); });
    const tools: any[] = [];
    dshWorkflow({ registerTool: (tool: any) => tools.push(tool) } as any);
    await assert.rejects(tools.find((tool) => tool.name === "workflow").execute("id", {
      name: "bad", concurrency: 0, phases: [{ title: "one", mode: "parallel", workers: [] }],
    }, undefined, undefined, { cwd: process.cwd() }), /concurrency/);
    assert.equal(spawnCalls, 0);
    (workflowModule as any).__setSpawnForTest();
  });
  test("thrown worker failures preserve diagnostic and never render undefined", () => {
    const result = { worker: "x", task: "", ok: false, output: "", error: "spawn failed" };
    assert.equal(renderResult(result), "ERROR: spawn failed");
    assert.doesNotMatch(renderResult(result), /undefined/);
  });
  test("failure diagnostics and empty success render honestly", () => {
    assert.equal(renderResult({ worker: "x", task: "", ok: false, output: "exit 2", error: "exit 2" }), "ERROR: exit 2");
    assert.match(renderResult({ worker: "x", task: "", ok: true, output: "" }), /empty output/);
    assert.equal(renderResult({ worker: "x", task: "", ok: true, output: "done" }), "done");
  });
  test("capture is bounded and marks truncation", () => {
    const c = new BoundedCapture(10); c.append("abcdefghijklmno");
    assert.match(c.toString(), /truncated/); assert.ok(c.toString().length < 40);
  });
  test("Ralph failure after success preserves the last valid handoff", async () => {
    const workflowModule = await import("../dsh-workflow.ts");
    let calls = 0;
    (workflowModule as any).__setSpawnForTest(() => {
      calls++;
      const child: any = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      setImmediate(() => {
        if (calls === 1) {
          child.stdout.end(JSON.stringify({ type: "message_end", subtype: "agent", message: { content: [{ type: "text", text: '```report-json\n{"status":"continue","summary":"first result","next":"retain this handoff"}\n```' }] } }) + "\n");
          child.stderr.end(); child.emit("close", 0);
        } else {
          child.stdout.end(); child.stderr.end("second round diagnostic"); child.emit("close", 2);
        }
      });
      return child;
    });
    try {
      const tools: any[] = [];
      dshWorkflow({ registerTool: (tool: any) => tools.push(tool) } as any);
      const result = await tools.find((tool) => tool.name === "ralph").execute("id", { objective: "test", maxRounds: 2 }, undefined, undefined, { cwd: process.cwd() });
      assert.equal(calls, 2);
      assert.equal(result.details.terminal, "round-failed");
      assert.equal(result.details.handoff.summary, "first result");
      assert.equal(result.details.handoff.next, "retain this handoff");
      assert.match(result.content[0].text, /Round 2 report/);
    } finally { (workflowModule as any).__setSpawnForTest(); }
  });
  test("Ralph unparsable report after success preserves the last valid handoff", async () => {
    const workflowModule = await import("../dsh-workflow.ts");
    let calls = 0;
    (workflowModule as any).__setSpawnForTest(() => {
      calls++;
      const child: any = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      setImmediate(() => {
        if (calls === 1) {
          child.stdout.end(JSON.stringify({ type: "message_end", subtype: "agent", message: { content: [{ type: "text", text: '```report-json\n{"status":"continue","summary":"first result","next":"retain this handoff"}\n```' }] } }) + "\n");
        } else {
          child.stdout.end(JSON.stringify({ type: "message_end", subtype: "agent", message: { content: [{ type: "text", text: "finished work but emitted no report block" }] } }) + "\n");
        }
        child.stderr.end(); child.emit("close", 0);
      });
      return child;
    });
    try {
      const tools: any[] = [];
      dshWorkflow({ registerTool: (tool: any) => tools.push(tool) } as any);
      const result = await tools.find((tool) => tool.name === "ralph").execute("id", { objective: "test", maxRounds: 2 }, undefined, undefined, { cwd: process.cwd() });
      assert.equal(calls, 2);
      assert.equal(result.details.terminal, "round-failed");
      assert.equal(result.details.handoff.summary, "first result");
      assert.equal(result.details.handoff.next, "retain this handoff");
      assert.match(result.details.failure ?? "", /Unparseable report/);
    } finally { (workflowModule as any).__setSpawnForTest(); }
  });

  test("Ralph requires status-specific fields and bounds handoff", () => {
    assert.equal(parseRalphReport('{"status":"continue","summary":"x"}'), null);
    assert.equal(parseRalphReport('{"status":"blocked","summary":"x","blocker":"stuck"}')?.status, "blocked");
    assert.equal(parseRalphReport("garbage"), null);
    assert.ok(formatRalphHandoff({ status: "complete", summary: "x".repeat(50000) }, 1).length <= 16384);
  });
  test("workflow limits accept exact boundaries and reject overflow", async () => {
    assert.equal(validWorkflowMode("serial"), true); assert.equal(validWorkflowMode("pipeline"), true); assert.equal(validWorkflowMode("parallel"), true); assert.equal(validWorkflowMode("other"), false);
    assert.equal(normalizeWorkflowMode("pipeline"), "serial"); assert.equal(normalizeWorkflowMode("parallel"), "parallel");
    assert.equal(validateWorkflowLimits([], 1), undefined);
    assert.equal(validateWorkflowLimits([], 16), undefined);
    assert.throws(() => validateWorkflowLimits([], 0), /concurrency/);
    assert.throws(() => validateWorkflowLimits([], 17), /concurrency/);
    assert.equal(validateWorkflowLimits([{ workers: Array(32) }], 4), undefined);
    assert.throws(() => validateWorkflowLimits([{ workers: Array(33) }], 4), /total workers/);
    assert.equal(validateWorkflowLimits([{ workers: Array(64) }], 4, 100), undefined);
    assert.throws(() => validateWorkflowLimits([{ workers: Array(65) }], 4, 100), /phase exceeds 64 items/);
    const source = await (await import("node:fs/promises")).readFile(new URL("../dsh-workflow.ts", import.meta.url), "utf8");
    assert.match(source, /const DEFAULT_CONCURRENCY = 4/);
  });
}
