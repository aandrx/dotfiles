/**
 * dsh-token-meter — ported from DeepSeek Harness `@deepseek-ai/dsh-token-meter`.
 *
 * Session instrumentation surfaced as a live status line matching the DSH web
 * UI format (current footer order: turns/steps | CH | P/C + Out |
 * LLM/tool call + throughput, abbreviated to fit one line):
 *
 *   N turns · M steps | CH 77% | P/C 2.0M (in 100K · rd 1.9M) · Out 32.2K |
 *   LLM 2m18s · Tool 31s · 78 tok/s
 *
 * P/C = prompt/context total; parenthetical splits it as in = uncached input
 * (miss), rd = cache read (hit), wr = cache write (shown only when nonzero).
 *
 * - turns/steps come from pi's own `turn_start`/assistant `message_end` events;
 * - LLM time is the wall-clock span of each assistant stream (message_start →
 *   message_end); Tool call time is tool_execution_start → end; TTFT is the
 *   time to the first streamed delta; tok/s is output tokens / LLM time;
 * - Cache hit and Input/Output fold the per-call `Usage` (input/cacheRead/
 *   cacheWrite/output) from assistant `message_end`, plus persisted entries on
 *   resume — the signal that the KV cache is staying warm.
 *
 * This is the instrumentation layer. The compaction extension (dsh-compaction)
 * is what actually PRESERVES the warm prefix; this one makes it measurable.
 * Timing (LLM/tool/TTFT) is measured in-process, so on RESUME those segments
 * restart at zero while turns/steps/tokens re-seed from persisted history.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Usage } from "@earendil-works/pi-ai";
import { freshUsageTotals, foldUsage } from "./lib/usage.ts";

const STATUS_KEY = "dsh-token";

interface SessionTotals {
  turns: number;
  /** LLM calls (assistant messages) — the DSH "steps". */
  steps: number;
  /** Cumulative assistant streaming wall time (ms). */
  llmMs: number;
  /** Cumulative tool execution wall time (ms). */
  toolMs: number;
  /** Cumulative time-to-first-token (ms) and how many streams measured. */
  ttftMs: number;
  ttftCount: number;
  /** Decode phase (first token → assembled message) wall time + output tokens.
   *  Mirrors upstream session-stats decodeMs/decodeTokens: only steps carrying
   *  both a measured decode window and provider output count. */
  decodeMs: number;
  decodeTokens: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costTotal: number;
  model: string;
}

const freshTotals = (): SessionTotals => ({ ...freshUsageTotals(),
  turns: 0,
  steps: 0,
  llmMs: 0,
  toolMs: 0,
  ttftMs: 0,
  ttftCount: 0,
  decodeMs: 0,
  decodeTokens: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  costTotal: 0,
  model: "",
});

function addUsage(totals: SessionTotals, usage: Usage | undefined): void {
  foldUsage(totals, usage);
}

/**
 * Rebuild session-derived counters (turns/steps/tokens) from an already
 * persisted session's entries (used on RESUME so the stat line shows real
 * historical usage instead of resetting to zero). Timings cannot be recovered
 * from entries and intentionally stay 0 until new activity.
 */
function seedFromEntries(totals: SessionTotals, entries: unknown[]): void {
  for (const raw of entries as { type?: string; message?: unknown }[]) {
    if (raw?.type !== "message") continue;
    const msg = (raw as { message: unknown }).message as {
      role?: string;
      usage?: Usage;
    };
    if (msg?.role === "user") totals.turns += 1;
    if (msg?.role === "assistant") {
      totals.steps += 1;
      addUsage(totals, msg.usage);
    }
  }
}

/** DSH-style duration: "138m44s", "62m17s", "11s". */
const fmtDuration = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m${String(r).padStart(2, "0")}s`;
};

/** Seconds with sensible precision: "11s", "0.8s", "1.5s". */
const fmtSec = (ms: number): string => {
  const s = ms / 1000;
  if (s >= 10) return `${Math.round(s)}s`;
  return `${s.toFixed(1).replace(/\.0$/, "")}s`;
};

/** DSH-style token count: "59.5M", "845K", "278". */
const fmtTokens = (n: number): string => {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n)}`;
};

/** Format a 0..1 ratio as a compact percentage string. */
const pct = (r: number): string => {
  const p = r * 100;
  if (p >= 10) return `${Math.round(p)}%`;
  return `${p.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
};

export default function dshTokenMeter(pi: ExtensionAPI): void {
  let totals = freshTotals();

  // Streaming state for the CURRENT assistant message (pi streams one at a
  // time): message_start → first delta = TTFT; start → message_end = LLM time.
  let msgStart: number | null = null;
  let ttftMeasured = false;
  // First-token timestamp for the decode window (first delta → message_end).
  let firstTokenAt: number | null = null;
  // Length of assistant text seen so far in the current stream, used so TTFT
  // fires only on the first update where the text actually grows.
  let lastTextLen = 0;
  // True while an assistant stream opened by message_start has not yet seen
  // its message_end. Orphaned streams (cut off by a new turn, agent_end, or
  // compaction) still count as a step but fold no timing or usage.
  let pendingStep = false;
  // Whether the current turn already had a step counted for it. Turns only
  // count when they contain at least one step.
  let turnCounted = false;
  // Newest provider prompt size (input + cacheRead + cacheWrite from the last
  // message_end usage) and the cumulative input total at that moment.
  // Projected next prompt = lastSample + (currentCumulative - snapshot).
  let lastSample = 0;
  let sampleSnapshot = 0;
  // Tool durations, keyed by toolCallId (tools can overlap).
  const toolStarts = new Map<string, number>();

  // The session id we last saw. A NEW id means a genuinely new session (fresh
  // totals). pi can re-emit session_start for the SAME session (restore/
  // switch/commands); blindly resetting there would wipe cumulative totals.
  let lastSessionId: string | undefined;

  const cumulativeInput = (): number =>
    totals.input + totals.cacheRead + totals.cacheWrite;

  // Length of the assistant text in a streamed message snapshot. Content is
  // normally an array of blocks; be liberal here since this is only a clock.
  const assistantTextLen = (message: unknown): number => {
    const content = (message as { content?: unknown })?.content;
    if (typeof content === "string") return content.length;
    if (!Array.isArray(content)) return 0;
    let n = 0;
    for (const block of content as { type?: string; text?: unknown }[]) {
      if (block?.type === "text" && typeof block.text === "string") {
        n += block.text.length;
      }
    }
    return n;
  };

  // Mark the active turn as non-empty (counted once). Resume seeding from
  // persisted user messages is kept as-is and remains an approximation.
  const markTurnCounted = (): void => {
    if (!turnCounted) {
      totals.turns += 1;
      turnCounted = true;
    }
  };

  // Close an open assistant stream as orphaned: count the step (and its turn)
  // with no timing or usage folded in.
  const orphanPendingStep = (): void => {
    if (!pendingStep) return;
    pendingStep = false;
    totals.steps += 1;
    markTurnCounted();
    msgStart = null;
    firstTokenAt = null;
    ttftMeasured = false;
    lastTextLen = 0;
  };

  const renderStatus = (ctx: ExtensionContext): void => {
    // Cache hit uses DeepSeek's canonical definition for prompt-prefix caching:
    //   cacheRead / (cacheRead + input)
    // cacheRead = tokens served from the warm prefix; input = tokens that had to
    // be (re)computed (cache miss). cacheWrite is deliberately excluded — it's
    // the write side of the same computed tokens, not an extra hit/miss term.
    // Session-cumulative on purpose: a single message's ratio is too noisy.
    const cacheHit =
      totals.cacheRead + totals.input > 0
        ? totals.cacheRead / (totals.cacheRead + totals.input)
        : null;
    const tokPerSec = totals.decodeMs > 0 ? Math.round(totals.decodeTokens / (totals.decodeMs / 1000)) : null;

    const promptTotal = totals.input + totals.cacheRead + totals.cacheWrite;

    // LLM / tool-call timings (throughput tok/s folded in as its natural home).
    const llmParts: string[] = [];
    if (totals.steps > 0) {
      llmParts.push(`LLM ${fmtDuration(totals.llmMs)} · Tool ${fmtDuration(totals.toolMs)}`);
    } else {
      llmParts.push(`LLM -- · Tool --`);
    }
    llmParts.push(`${tokPerSec ?? "--"} tok/s`);

    // Order: turns/steps | CH | P/C + Out | LLM/tool call.
    // Abbreviated (CH, P/C, in/rd/wr) so the whole line fits one row.
    const parts: string[] = [];
    parts.push(`${totals.turns} turns · ${totals.steps} steps`);
    parts.push(`CH ${cacheHit != null ? pct(cacheHit) : "--"}`);
    const cacheBits = [`in ${fmtTokens(totals.input)}`, `rd ${fmtTokens(totals.cacheRead)}`];
    if (totals.cacheWrite > 0) cacheBits.push(`wr ${fmtTokens(totals.cacheWrite)}`);
    parts.push(`P/C ${fmtTokens(promptTotal)} (${cacheBits.join(" · ")}) · Out ${fmtTokens(totals.output)}`);
    parts.push(llmParts.join(" · "));
    ctx.ui.setStatus(STATUS_KEY, parts.join(" | "));
  };

  pi.on("session_start", (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    if (sessionId === lastSessionId) {
      // Same session re-emitted — keep cumulative totals, just refresh.
      renderStatus(ctx);
      return;
    }
    lastSessionId = sessionId;
    totals = freshTotals();
    pendingStep = false;
    turnCounted = false;
    lastTextLen = 0;
    lastSample = 0;
    sampleSnapshot = 0;
    seedFromEntries(totals, ctx.sessionManager.getEntries());
    renderStatus(ctx);
  });

  pi.on("turn_start", (_event, ctx) => {
    // A new turn with a stream still open means that stream will never see
    // message_end: count it as an orphaned step, untimed. Orphaned tool
    // starts are dropped without folding into toolMs.
    orphanPendingStep();
    toolStarts.clear();
    turnCounted = false;
    renderStatus(ctx);
  });

  pi.on("message_start", (event, ctx) => {
    // A start arriving while a stream is pending means the old stream was
    // cut off: count it as orphaned before opening the new one.
    if (pendingStep) orphanPendingStep();
    if (event.message?.role !== "assistant") return;
    pendingStep = true;
    msgStart = Date.now();
    ttftMeasured = false;
    firstTokenAt = null;
    lastTextLen = 0;
  });

  pi.on("message_update", (event, _ctx) => {
    if (event.message?.role !== "assistant") return;
    const len = assistantTextLen(event.message);
    if (msgStart != null && !ttftMeasured && len > lastTextLen) {
      const now = Date.now();
      totals.ttftMs += now - msgStart;
      totals.ttftCount += 1;
      ttftMeasured = true;
      firstTokenAt = now;
    }
    lastTextLen = Math.max(lastTextLen, len);
  });

  // Fold real per-call usage from the ASSISTANT's final message when it lands,
  // and close the LLM timing window.
  pi.on("message_end", (event, ctx) => {
    if (event.message?.role !== "assistant") return;
    const endAt = Date.now();
    if (msgStart != null) {
      totals.llmMs += endAt - msgStart;
      msgStart = null;
    }
    // Decode window only when both the first-token time and provider output
    // are known (upstream session-stats parity).
    if (firstTokenAt != null && (event.message?.usage?.output ?? 0) > 0) {
      totals.decodeMs += Math.max(0, endAt - firstTokenAt);
      totals.decodeTokens += event.message.usage.output ?? 0;
    }
    firstTokenAt = null;
    ttftMeasured = false;
    lastTextLen = 0;
    pendingStep = false;
    addUsage(totals, event.message?.usage);
    // Newest provider prompt size plus the cumulative input total now, so a
    // later projected estimate can add only the growth since this sample.
    const u = event.message?.usage;
    if (u) {
      lastSample = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
      sampleSnapshot = cumulativeInput();
    }
    totals.steps += 1;
    markTurnCounted();
    renderStatus(ctx);
  });

  pi.on("tool_execution_start", (event, _ctx) => {
    toolStarts.set(event.toolCallId, Date.now());
  });

  pi.on("tool_execution_end", (event, ctx) => {
    const start = toolStarts.get(event.toolCallId);
    if (start != null) {
      totals.toolMs += Date.now() - start;
      toolStarts.delete(event.toolCallId);
    }
    renderStatus(ctx);
  });

  // Re-render on agent_end so the footer stays current even when no usage
  // numbers were available on the events. A stream still open here never
  // got its message_end, so count it as an orphaned step, untimed.
  pi.on("agent_end", (_event, ctx) => {
    orphanPendingStep();
    const model = ctx.model;
    if (model) totals.model = `${model.provider}/${model.id}`;
    renderStatus(ctx);
  });

  // Keep the footer fresh after compaction / context changes. Compaction
  // cuts off any open stream, so count it as an orphaned step, untimed.
  pi.on("session_compact", (_event, ctx) => {
    orphanPendingStep();
    renderStatus(ctx);
  });
  pi.on("model_select", (_event, ctx) => renderStatus(ctx));

  // /dsh-status — full snapshot, parseable text.
  pi.registerCommand("dsh-status", {
    description: "Show DeepSeek-Harness-style token & cache accounting for this session",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const usage = ctx.getContextUsage();
      const tokPerSec = totals.decodeMs > 0 ? Math.round(totals.decodeTokens / (totals.decodeMs / 1000)) : null;
      const ttftAvg = totals.ttftCount > 0 ? totals.ttftMs / totals.ttftCount : null;
      // Canonical DeepSeek prompt-cache hit rate, session-cumulative.
      const cacheHit =
        totals.cacheRead + totals.input > 0
          ? totals.cacheRead / (totals.cacheRead + totals.input)
          : null;

      const lines: string[] = [];
      lines.push(`turns:        ${totals.turns}`);
      lines.push(`steps:        ${totals.steps}`);
      lines.push(`llm time:     ${fmtDuration(totals.llmMs)}`);
      lines.push(`tool time:    ${fmtDuration(totals.toolMs)}`);
      lines.push(`ttft avg:     ${ttftAvg != null ? fmtSec(ttftAvg) : "--"}`);
      lines.push(`decode tok/s: ${tokPerSec ?? "--"}`);
      lines.push(`decode time:  ${fmtDuration(totals.decodeMs)}`);
      lines.push(`decode tok:   ${totals.decodeTokens}`);
      lines.push(
        `context:      ${usage?.tokens ?? "--"} / ${usage?.contextWindow ?? "--"} tokens (${usage?.tokens != null && usage?.contextWindow ? pct(usage.tokens / usage.contextWindow) : "--"})`,
      );
      lines.push(`input:        ${totals.input}`);
      lines.push(`cache read:   ${totals.cacheRead}`);
      lines.push(`cache write:  ${totals.cacheWrite}`);
      lines.push(`output:       ${totals.output}`);
      lines.push(`cache hit:    ${cacheHit != null ? pct(cacheHit) : "--"}`);
      lines.push(
        `projected next: ${lastSample + (cumulativeInput() - sampleSnapshot)} tokens`,
      );
      lines.push(`calls:        ${totals.steps}`);
      if (totals.costTotal > 0) lines.push(`est. cost:    $${totals.costTotal.toFixed(4)}`);
      if (totals.model) lines.push(`model:        ${totals.model}`);
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
