/**
 * dsh-compaction provides an alternate summary call and tool-result pruning.
 * pi owns the compaction cut and threshold; the routed output reservation is
 * not exposed, and no prefix-cache reuse is guaranteed. Exact routed-request replay, dynamic tool history, and proactive
 * prune/remeasure/skip are unsupported non-goals.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  COMPACTION_INSTRUCTION,
  pruneOversizedToolResults,
  pruneNotice,
  resolvePruneConfig,
  resolveSummaryMaxTokens,
  validateSummaryResponse,
  type ToolResultPruneConfig,
} from "./lib/compaction.ts";
import type { DshMessage } from "./lib/estimate.ts";

/** Configuration; tune via a `settings`-style constant or keep defaults. */
export interface DshCompactionConfig {
  /** Summarization model id; default reuses the conversation model. */
  summarizationModel?: string;
  /** Optional output cap override for the summarization call. */
  maxTokens?: number;
}

const DEFAULT_CONFIG: DshCompactionConfig = {};

/** Tool-result pruning applied to the summarization input (upstream defaults). */
const PRUNE_CONFIG: ToolResultPruneConfig = {};

const config: DshCompactionConfig = DEFAULT_CONFIG;

/** pi extension factory: loads as the default export of this file. */
export default function dshCompaction(pi: ExtensionAPI): void {
    pi.on("session_before_compact", async (event, ctx) => {
      const { preparation, branchEntries: _branchEntries, signal, reason, willRetry } = event;
      const {
        messagesToSummarize,
        turnPrefixMessages,
        tokensBefore,
        firstKeptEntryId,
        previousSummary,
      } = preparation;

      // Nothing meaningful to condense? Let pi handle edge cases; but if there
      // are no messages, there is nothing to summarize -> fall back to default.
      const toCondense = [...messagesToSummarize, ...turnPrefixMessages];
      if (toCondense.length === 0) {
        return; // no custom result -> pi uses its default path
      }

      // ---- Choose the summarization model ----
      // Default: reuse the conversation's own model so the prefix cache is the
      // same cache the conversation uses. Optionally pin a cheaper model.
      const conversationModel = ctx.model;
      let model = conversationModel;
      if (config.summarizationModel) {
        const found = ctx.modelRegistry.find("*", config.summarizationModel) ??
          ctx.modelRegistry.getAll().find((m) => m.id === config.summarizationModel);
        if (found) model = found;
        else {
          // Fall back to the conversation model rather than failing.
          model = conversationModel;
        }
      }
      if (!model) {
        // No model available; let pi decide.
        return;
      }

      // ---- Build the cache-aligned completion context ----
      // The DSH property: reuse the conversation's own system prompt and tool
      // schemas, and deliver the shadowed messages AS structure (not flattened).
      // Same sessionId + system prompt + tools + long retention improve warm-cache
      // odds, but exact routed-request replay is an unsupported non-goal.
      const sessionId = ctx.sessionManager.getSessionId();
      const systemPrompt = ctx.getSystemPrompt();

      // ---- Prune over-budget tool results (upstream tool-result-pruner) ----
      // Shrink giant tool outputs to head/marker/tail BEFORE summarizing so the
      // summarization call itself is cheaper and stays prefix-stable. Pure and
      // model-free; originals stay in the durable log, only the replayed copy
      // is rewritten. pi (not this extension) owns the compact trigger decision,
      // so unlike upstream there is no re-measure-and-skip here.
      const pruneCfg = resolvePruneConfig(PRUNE_CONFIG);
      // Lazily imported: keeps this module loadable outside pi (tests),
      // while resolving identically under the pi runtime.
      const { convertToLlm } = await import("@earendil-works/pi-coding-agent");
      const converted = convertToLlm(toCondense);
      const leadMessages = pruneOversizedToolResults(converted, pruneCfg);
      const notice = pruneNotice(leadMessages.some((m, i) => m !== converted[i]), reason, willRetry);
      if (notice && !signal?.aborted) ctx.ui.notify(notice, "info");
      const priorContext = previousSummary
        ? `\n\nA prior checkpoint already exists; consolidate it with the new material under a single structure.\n<prior-summary>\n${previousSummary}\n</prior-summary>`
        : "";

      const context: import("@earendil-works/pi-ai").Context = {
        systemPrompt,
        // Include the conversation's own tool schemas; same sessionId, system
        // prompt, tools, and long retention improve warm-cache odds. Exact
        // routed-request replay is unsupported. ToolInfo carries pi-ai Tool shape.
        tools: pi.getAllTools().map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
        messages: [
          ...leadMessages,
          {
            role: "user" as const,
            content: [
              {
                type: "text" as const,
                text: `${COMPACTION_INSTRUCTION}${priorContext}`,
              },
            ],
            timestamp: Date.now(),
          },
        ],
      };

      const maxTokens = resolveSummaryMaxTokens(config.maxTokens, preparation.settings?.reserveTokens, model.maxTokens);
      let response: import("@earendil-works/pi-ai").AssistantMessage;
      try {
        response = await ctx.modelRegistry.complete(
          model,
          context,
          {
            maxTokens,
            signal,
            // DSH: `long` gives the provider a chance to retain overlapping
            // prefixes across the boundary; it does not replay the exact routed request.
            cacheRetention: "long",
            sessionId,
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Never wedge compaction: notify and fall back to pi's default path.
        if (!signal?.aborted) {
          ctx.ui.notify(`dsh-compaction failed, using default: ${message}`, "error");
        }
        return;
      }

      const summaryText = (response.content ?? [])
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");

      // DSH frames the replacement as established background; keep that framing
      // so the resumed model treats it as context, not as a request to answer.
      // Fail closed: truncation, empty, or non-shrinking summaries fall back
      // to pi's default path instead of becoming a session checkpoint.
      const validation = validateSummaryResponse({
        stopReason: response.stopReason,
        summaryText,
        sourceMessages: toCondense as unknown as DshMessage[],
      });
      if (!validation.ok) {
        if (!signal?.aborted) {
          const why =
            validation.reason === "truncated"
              ? "summary truncated"
              : validation.reason === "empty"
                ? "produced empty summary"
                : "summary did not shrink source";
          ctx.ui.notify(`dsh-compaction ${why} (${reason}; retry=${willRetry}), using default`, "warning");
        }
        return;
      }
      // Framing is centralized in frameSummaryText() (called inside
      // validateSummaryResponse above); use the validated framed text as-is.
      const framed = validation.framed;

      return {
        compaction: {
          summary: framed,
          firstKeptEntryId,
          tokensBefore,
          usage: response.usage,
          details: { source: "pi-dsh-core", engine: "dsh-compaction-basic", reason, willRetry },
        },
      };
    });

    // Expose the trigger + instruction for manual control (mirrors DSH /compact).
    pi.registerCommand("dsh-compact", {
      description: "Trigger the dsh cache-reusing compaction immediately",
      handler: async (_args, ctx: ExtensionContext) => {
        ctx.compact({ onError: (e) => ctx.ui.notify(`compaction error: ${e.message}`, "error") });
      },
    });

    // Also expose a model-facing tool so the agent can compact itself.
    pi.registerTool({
      name: "dsh_compact",
      label: "DSH Compact",
      description:
        "Trigger DeepSeek-Harness-style cache-reusing compaction of the conversation when context is getting long. Use sparingly.",
      parameters: Type.Object({
        reason: Type.Optional(Type.String({ description: "Optional reason for compacting." })),
      }),
      async execute(toolCallId, _params, _signal, _onUpdate, ctx) {
        // Fire-and-forget compaction that NEVER blocks the model. pi's
        // ctx.compact() wraps the work in `void (async () => …)()` — it returns
        // immediately and calls onComplete/onError only later. Silently awaiting
        // those callbacks can hang the agent forever if the summarization
        // stalls, which derails fragile local models. So we race the callbacks
        // against a short timeout and always return promptly.
        const outcome = await new Promise<string>((resolve) => {
          let settled = false;
          const finish = (msg: string) => {
            if (settled) return;
            settled = true;
            resolve(msg);
          };
          ctx.compact({
            onComplete: (result) =>
              finish(
                result?.summary
                  ? `Compaction completed (dsh style). Summary created (${result.summary.length} chars).`
                  : "Compaction completed (dsh style).",
              ),
            onError: (error) => finish(`Compaction could not run: ${error.message}`),
          });
          // Guarantee the tool resolves even if pi never calls back.
          setTimeout(() => finish("Compaction requested; it will apply if the session has enough content."), 3000);
        });
        return {
          content: [{ type: "text", text: outcome }],
          details: {},
        };
      },
    });
}
