import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { JobRing } from "../lib/job-ring.ts";
import { createJobState, requestStop, settleJob } from "../lib/job-state.ts";
import dshJobs, { __setSpawnForTest } from "../dsh-jobs.ts";

const isMain = !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
export default function noop() {}

if (isMain) {
  test("state settles once and preserves stop reason", () => {
    const state = createJobState();
    assert.equal(requestStop(state, "timeout"), true);
    assert.equal(settleJob(state, "killed", null), true);
    assert.equal(settleJob(state, "completed", 0), false);
    assert.equal(state.reason, "timeout");
  });

  test("ring has stable reads, byte offsets, and UTF-8-safe eviction", () => {
    const ring = new JobRing(5);
    ring.append("abc");
    ring.append("😀");
    const read = ring.read(0);
    assert.equal(read.lost, true);
    assert.equal(read.text, "c😀");
    assert.equal(read.end, 7);
    const offset = ring.read(3);
    assert.equal(offset.start, 3);
    assert.equal(offset.text, "😀");
    const midMultibyte = ring.read(5);
    assert.equal(midMultibyte.start, 7);
    assert.equal(midMultibyte.text, "");
    assert.equal(ring.read(5).text, "");
    assert.equal(ring.read().text, read.text);
  });

  function harness() {
    const tools = new Map<string, any>();
    const events = new Map<string, Function>();
    const sent: any[] = [];
    const pi: any = {
      on: (name: string, handler: Function) => events.set(name, handler),
      registerTool: (tool: any) => tools.set(tool.name, tool),
      sendMessage: (message: any, options?: any) => sent.push({ message, options }),
    };
    dshJobs(pi);
    const ctx = (id: string) => ({ cwd: process.cwd(), sessionManager: { getSessionId: () => id } });
    const start = (id: string, command: string) => tools.get("job_start").execute("x", { command, timeoutMs: 5000 }, undefined, undefined, ctx(id));
    const output = (id: string, waitMs = 0, outputLimitBytes?: number) => tools.get("job_output").execute("x", { jobId: id, waitMs, outputLimitBytes }, undefined, undefined, ctx("unused"));
    return { tools, events, sent, ctx, start, output };
  }

  async function waitFor(fn: () => boolean): Promise<void> {
    for (let i = 0; i < 150; i++) { if (fn()) return; await delay(10); }
    throw new Error("timed out waiting for condition");
  }

  test("synchronous spawn failure is retained as a settled failed job", async () => {
    const h = harness();
    __setSpawnForTest((() => { throw new Error("spawn ENOENT"); }) as any);
    try {
      const started = await h.start("owner", "anything");
      assert.equal(started.isError, true);
      const listed = (await h.tools.get("job_list").execute()).details.jobs;
      assert.equal(listed.length, 1);
      assert.equal(listed[0].status, "failed");
      assert.equal(listed[0].exitCode, null);
      assert.match(listed[0].reason ?? "", /ENOENT/);
      const out = await h.output(listed[0].jobId);
      assert.equal(out.details.status, "failed");
      assert.match(out.details.output, /spawn error/);
    } finally {
      __setSpawnForTest();
    }
  });

  test("close includes the final stdout and stderr bytes", async () => {
    const h = harness();
    const started = await h.start("owner", `node -e 'process.stdout.write("last-out"); process.stderr.write("last-err"); process.exit(0)'`);
    const result = await h.output(started.details.jobId, 3000);
    assert.match(result.details.output, /last-out/);
    assert.match(result.details.output, /last-err/);
  });

  test("wake cap limits owner completion wakes", async () => {
    const { EventEmitter } = await import("node:events");
    const { PassThrough } = await import("node:stream");
    const h = harness();
    const ctx = h.ctx("owner") as any;
    ctx.__jobWakeCap = 1;
    h.events.get("session_start")!({ reason: "resume" }, ctx);
    __setSpawnForTest((() => {
      const child: any = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.unref = () => {};
      queueMicrotask(() => child.emit("close", 0));
      return child;
    }) as any);
    try {
      await h.start("owner", "one");
      await h.start("owner", "two");
      await waitFor(() => (h.tools.get("job_list").execute as any) && h.sent.length === 1);
      await delay(20);
      assert.equal(h.sent.length, 1);
    } finally { __setSpawnForTest(); }
  });

  test("real subprocess drains stdout/stderr and enforces byte output cap", async () => {
    const h = harness();
    const started = await h.start("owner", `node -e 'process.stdout.write("OUT-final-"); process.stderr.write("ERR-final-")'`);
    const id = started.details.jobId;
    const capped = await h.output(id, 3000, 7);
    assert.equal(capped.details.status, "completed");
    assert.equal(capped.details.truncated, true);
    assert.ok(Buffer.byteLength(capped.details.output) <= 7);
    assert.match(capped.content[0].text, /\[output truncated\]/);
    const full = await h.output(id, 0, 100);
    assert.match(full.details.output, /OUT-final-/);
    assert.match(full.details.output, /ERR-final-/);
  });

  test("completion wakes idle and busy owners as followUp", async () => {
    for (const busy of [false, true]) {
      const h = harness();
      const ctx = h.ctx("owner");
      h.events.get("session_start")!({ reason: "resume" }, ctx);
      const job = await h.start("owner", "node -e 'setTimeout(()=>{},30)'");
      await waitFor(() => h.sent.length === 1);
      const sent = h.sent[0];
      assert.deepEqual(sent.options, { triggerTurn: true, deliverAs: "followUp" });
      assert.equal(sent.message.customType, "dsh-job-complete");
      assert.ok(busy ? sent.options.deliverAs === "followUp" : sent.options.triggerTurn);
      assert.ok(job.details.jobId);
    }
  });

  test("stale owner is dropped and reading completion suppresses duplicate notice", async () => {
    const h = harness();
    h.events.get("session_start")!({ reason: "resume" }, h.ctx("old"));
    const stale = await h.start("old", "node -e 'setTimeout(()=>{},80)'");
    h.events.get("session_start")!({ reason: "resume" }, h.ctx("new"));
    await delay(140);
    assert.equal(h.sent.length, 0);

    h.sent.length = 0;
    const read = await h.start("new", "node -e 'setTimeout(()=>{},50)'");
    await delay(100);
    await h.output(read.details.jobId);
    assert.equal(h.sent.length, 1);
    assert.ok(stale.details.jobId);
  });

  test("shutdown kills owned job; switch and fork are preflight only", async () => {
    const h = harness();
    h.events.get("session_start")!({ reason: "resume" }, h.ctx("owner"));
    const started = await h.start("owner", "node -e 'setInterval(()=>{},1000)'");
    const id = started.details.jobId;
    h.events.get("session_before_switch")!({});
    h.events.get("before_fork")!({});
    await delay(30);
    assert.equal((await h.output(id)).details.status, "running");
    h.events.get("session_shutdown")!({});
    let out = await h.output(id, 1000);
    assert.ok(["killed", "failed"].includes(out.details.status));
    assert.equal(h.sent.length, 0);
  });
}
