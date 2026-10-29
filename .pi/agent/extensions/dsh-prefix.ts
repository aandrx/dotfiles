import { createHash } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export function hashTranscript(messages: unknown): string {
  return createHash("sha256").update(JSON.stringify(messages)).digest("hex").slice(0, 12);
}

interface PrefixState {
  lastPromptHash: string | null;
  lastTranscriptHash: string | null;
  promptHashChanges: number;
  transcriptChanges: number;
  stableTurns: number;
  cacheRead: number;
  cacheInput: number;
  warmingDecision: Record<string, unknown> | null;
}
const fresh = (): PrefixState => ({ lastPromptHash: null, lastTranscriptHash: null, promptHashChanges: 0, transcriptChanges: 0, stableTurns: 0, cacheRead: 0, cacheInput: 0, warmingDecision: null });
const hash256 = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 12);

export default function dshPrefix(pi: ExtensionAPI): void {
  let state = fresh();
  let turnTranscriptHash: string | null = null;
  const render = (_ctx: ExtensionContext): void => {};
  pi.on("session_start", (_e, ctx) => { state = fresh(); turnTranscriptHash = null; render(ctx); });
  pi.on("context_with_system", (event) => {
    const messages = (event as { messages?: unknown }).messages;
    turnTranscriptHash = messages === undefined ? null : hashTranscript(messages);
  });
  pi.on("cache_warming_decision", (event) => {
    const e = event as { warmCost?: unknown; missCost?: unknown; continuationProbability?: unknown; action?: unknown };
    state.warmingDecision = { warmCost: e.warmCost, missCost: e.missCost, continuationProbability: e.continuationProbability, action: e.action };
  });
  pi.on("agent_end", (event, ctx) => {
    state.stableTurns += 1;
    const h = hash256(ctx.getSystemPrompt());
    if (state.lastPromptHash !== null && state.lastPromptHash !== h) {
      state.promptHashChanges += 1;
      if (state.promptHashChanges === 1) ctx.ui.notify("PROMPT-HASH changed; this is not full-prefix invalidation evidence.", "warning");
    }
    state.lastPromptHash = h;
    if (turnTranscriptHash !== null) {
      if (state.lastTranscriptHash !== null && state.lastTranscriptHash !== turnTranscriptHash) state.transcriptChanges += 1;
      state.lastTranscriptHash = turnTranscriptHash;
    }
    turnTranscriptHash = null;
    const messages = event.messages as Array<{ usage?: { input?: number; cacheRead?: number; cacheWrite?: number } }>;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const usage = messages[i]?.usage;
      if (usage && (usage.cacheRead || usage.input || usage.cacheWrite)) {
        state.cacheRead += usage.cacheRead ?? 0;
        state.cacheInput += (usage.input ?? 0) + (usage.cacheWrite ?? 0);
        break;
      }
    }
    render(ctx);
  });
  pi.registerCommand("dsh-prefix", { description: "Show observed prompt hash and cache usage", handler: async (_args, ctx) => {
    const d = state.warmingDecision;
    ctx.ui.notify(["dsh-prefix · observed cache telemetry", `PROMPT-HASH: ${state.lastPromptHash ?? "--"}`, `transcript hash: ${state.lastTranscriptHash ?? "--"}`, "tool-schema hash: unavailable; whole-request parity is not claimed", `stable turns: ${state.stableTurns}`, `prompt-hash changes: ${state.promptHashChanges}`, `transcript changes: ${state.transcriptChanges}`, `provider cache-read tokens: ${state.cacheRead}`, `provider cold-input tokens (input + cache writes): ${state.cacheInput}`, `pi cache-warming decision: ${d ? JSON.stringify(d) : "unobserved"}`].join("\n"), "info");
  }});
}
