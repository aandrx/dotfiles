/**
 * Pure helpers for compaction input pruning and summary framing.
 * pi owns the compaction cut and threshold; the routed output reservation is
 * not exposed to extensions, and no prefix-cache reuse is guaranteed. Routed-request replay and dynamic tool history
 * are unavailable, and proactive prune/remeasure/skip is not possible here.
 */

import { estimateMessage, type DshMessage } from "./estimate.ts";

export function pruneNotice(pruned: boolean, reason: string, willRetry: boolean): string | null {
  return pruned ? `dsh-compaction pruned oversized tool results (${reason}; retry=${willRetry}) before summarizing.` : null;
}

/* ------------------------------------------------------------------ */
/* COMP-1: summary-call output cap. Mirrors pi's own summary sizing.     */
/* DSH's routed-reservation headroom default is intentionally NOT        */
/* reproduced: the routed output reservation is not exposed here.       */
/* ------------------------------------------------------------------ */

/**
 * Resolve the summary-call output cap.
 * Explicit override wins; otherwise `floor(0.8 * reserveTokens)` (mirroring
 * pi), never exceeding the summary model's maxTokens.
 */
export function resolveSummaryMaxTokens(
  override: number | undefined,
  reserveTokens: number | undefined,
  modelMaxTokens: number,
): number {
  const requested = override ?? Math.floor(0.8 * (reserveTokens ?? modelMaxTokens));
  return Math.min(requested, modelMaxTokens);
}

/* ------------------------------------------------------------------ */
/* Replay-copy tool-result pruning (pure; structural role/content).      */
/* Only tool-result positions are rewritten; user/assistant text is      */
/* never touched so the replayed prefix stays otherwise verbatim.       */
/* ------------------------------------------------------------------ */

/**
 * Rewrite over-budget tool-result text in a replayed message list to
 * head/marker/tail (upstream tool-result-pruner behavior).
 *
 * Only touches tool-result positions (messages with a tool-result role or
 * tool-result content blocks); user/assistant text is never rewritten so the
 * replayed prefix stays otherwise verbatim. Structural and defensive: unknown
 * shapes pass through untouched.
 */
export function pruneOversizedToolResults<M>(
  messages: readonly M[],
  pruneCfg: Required<ToolResultPruneConfig>,
): M[] {
  return messages.map((raw) => {
    if (typeof raw !== 'object' || raw === null) return raw;
    const msg = raw as Record<string, unknown>;
    const role = typeof msg['role'] === 'string' ? (msg['role'] as string) : '';
    const content = msg['content'];
    if (!Array.isArray(content)) return raw;
    const isToolResult =
      role === 'toolResult' ||
      role === 'tool-result' ||
      content.some(
        (b) =>
          typeof b === 'object' &&
          b !== null &&
          typeof (b as Record<string, unknown>)['type'] === 'string' &&
          ['tool-result', 'toolResult'].includes(String((b as Record<string, unknown>)['type'])),
      );
    if (!isToolResult) return raw;
    let changed = false;
    const nextContent = content.map((b) => {
      if (typeof b !== 'object' || b === null) return b;
      const block = b as Record<string, unknown>;
      // Direct text on a tool-result message/block.
      if (typeof block['text'] === 'string') {
        const pruned = pruneText(block['text'] as string, pruneCfg);
        if (pruned !== block['text']) {
          changed = true;
          return { ...block, text: pruned };
        }
        return b;
      }
      // Nested tool-result block carrying its own content list.
      if (Array.isArray(block['content'])) {
        const inner = (block['content'] as unknown[]).map((innerBlock) => {
          if (
            typeof innerBlock === 'object' &&
            innerBlock !== null &&
            typeof (innerBlock as Record<string, unknown>)['text'] === 'string'
          ) {
            const pruned = pruneText(
              (innerBlock as Record<string, unknown>)['text'] as string,
              pruneCfg,
            );
            if (pruned !== (innerBlock as Record<string, unknown>)['text']) {
              changed = true;
              return { ...(innerBlock as Record<string, unknown>), text: pruned };
            }
          }
          return innerBlock;
        });
        if (changed) return { ...block, content: inner };
      }
      return b;
    });
    return changed ? ({ ...msg, content: nextContent } as M) : raw;
  });
}

/**
 * Tool-result pruner, ported from DeepSeek Harness
 * `@deepseek-ai/dsh-compaction-tool-result-pruner`.
 *
 * Rewrites over-budget tool-result text to a bounded head, a fixed omission
 * marker, and a bounded tail. Pure and model-free. Upstream applies this to
 * the surface BEFORE summarizing, and skips summarization entirely when the
 * remeasured request falls below pressure. Budgets are Unicode code points
 * (not tokens); slicing never splits a UTF-16 surrogate pair.
 */
export interface ToolResultPruneConfig {
  /** Prune when combined text exceeds this many code points. Default 8192. */
  thresholdChars?: number;
  /** Leading code points retained. Default 4096. */
  headChars?: number;
  /** Trailing code points retained. Default 1024. */
  tailChars?: number;
}

export const DEFAULT_PRUNE_CONFIG: Required<ToolResultPruneConfig> = {
  thresholdChars: 8192,
  headChars: 4096,
  tailChars: 1024,
};

/** Fixed marker substituted for every removed middle span. */
export const PRUNE_MARKER = '\n\n[... tool result middle pruned ...]\n\n';

export function resolvePruneConfig(
  config: ToolResultPruneConfig | undefined,
): Required<ToolResultPruneConfig> {
  const resolved: Required<ToolResultPruneConfig> = {
    thresholdChars: config?.thresholdChars ?? DEFAULT_PRUNE_CONFIG.thresholdChars,
    headChars: config?.headChars ?? DEFAULT_PRUNE_CONFIG.headChars,
    tailChars: config?.tailChars ?? DEFAULT_PRUNE_CONFIG.tailChars,
  };
  if (!Number.isInteger(resolved.thresholdChars) || resolved.thresholdChars <= 0) {
    throw new Error('ToolResultPruneConfig: thresholdChars must be a positive integer');
  }
  if (!Number.isInteger(resolved.headChars) || resolved.headChars < 0) {
    throw new Error('ToolResultPruneConfig: headChars must be a non-negative integer');
  }
  if (!Number.isInteger(resolved.tailChars) || resolved.tailChars < 0) {
    throw new Error('ToolResultPruneConfig: tailChars must be a non-negative integer');
  }
  const emitted =
    resolved.headChars + codePointLength(PRUNE_MARKER) + resolved.tailChars;
  if (emitted > resolved.thresholdChars) {
    throw new Error(
      `ToolResultPruneConfig: headChars + marker + tailChars (${emitted}) must be at most thresholdChars (${resolved.thresholdChars})`,
    );
  }
  return resolved;
}

/** Unicode code-point length (surrogate-pair safe, unlike String.length). */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}

/** Slice by code points without splitting a UTF-16 surrogate pair. */
export function codePointSlice(text: string, start: number, end?: number): string {
  const points = Array.from(text);
  return points.slice(start, end).join('');
}

/**
 * Prune one text span to head + marker + tail when over budget.
 * Returns the original string when within budget (never grows output, so a
 * second pass is a no-op).
 */
export function pruneText(
  text: string,
  config: Required<ToolResultPruneConfig>,
): string {
  if (codePointLength(text) <= config.thresholdChars) return text;
  const head = codePointSlice(text, 0, config.headChars);
  const tail =
    config.tailChars > 0
      ? codePointSlice(text, codePointLength(text) - config.tailChars)
      : '';
  return `${head}${PRUNE_MARKER}${tail}`;
}

/**
 * The structured summary instruction DSH appends as the FINAL user message
 * after the replayed conversation. Kept verbatim from DSH `summarizer.ts`
 * (`COMPACTION_INSTRUCTION`).
 */
export const COMPACTION_INSTRUCTION = [
  'You are now acting as a compaction engine for this AI coding assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.',
  '',
  'Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section — never drop a section.',
  '',
  '## Primary Request and Intent',
  "- [the user's original and evolving goals; quote verbatim where the exact wording matters]",
  '',
  '## Key Technical Concepts',
  '- [technologies, frameworks, patterns, and conventions in play]',
  '',
  '## Files and Code',
  '- [exact path: why it matters, key changes or snippets]',
  '',
  '## Errors and Fixes',
  '- [error: how it was resolved, plus any related user feedback]',
  '',
  '## Pending Jobs',
  '- [explicitly requested work not yet completed]',
  '',
  '## Current Work',
  '- [precisely what was in progress at this checkpoint]',
  '',
  '## Next Step',
  '- [the single next action, directly in line with the most recent request, or "(none)"]',
  '',
  '## Critical Context',
  '- [decisions and their rationale, constraints, user preferences, open questions, data needed to continue]',
  '',
  'Rules:',
  '- Write concise English engineering prose. Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments.',
  '- Capture user feedback and explicit instructions faithfully, especially corrections.',
  '- Do NOT mention this summarization request or that the context was compacted.',
  '- Output only the checkpoint text: do not call any tool or take any other action.',
  '- If the conversation already contains a <compacted-summary> block, it is a PRIOR checkpoint. Do not copy it forward verbatim: preserve still-true facts, drop stale ones, and merge newer information into a single consolidated summary under the same structure.',
].join('\n');

/** Framing that makes the replacement user message established context. */
export const CHECKPOINT_PREAMBLE =
  'This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.';

/** Wrap raw summary text in the durable checkpoint framing (DSH `frameSummary`). */
export function frameSummaryText(summaryTextValue: string): string {
  return `${CHECKPOINT_PREAMBLE}\n\n<compacted-summary>\n${summaryTextValue}\n</compacted-summary>`;
}

/* ------------------------------------------------------------------ */
/* COMP-2: fail-closed summary validation. Reject truncation, empty, or  */
/* non-shrinking summaries so they never become a session checkpoint.   */
/* ------------------------------------------------------------------ */

export type SummaryRejection = "truncated" | "empty" | "no-shrink";

export interface SummaryValidationInput {
  stopReason: string | undefined;
  summaryText: string;
  sourceMessages: readonly DshMessage[];
}

export function validateSummaryResponse(
  input: SummaryValidationInput,
): { ok: true; framed: string } | { ok: false; reason: SummaryRejection } {
  if (input.stopReason === "length") return { ok: false, reason: "truncated" };
  if (!input.summaryText.trim()) return { ok: false, reason: "empty" };
  const framed = frameSummaryText(input.summaryText);
  const sourceTokens = input.sourceMessages.reduce((sum, m) => sum + estimateMessage(m), 0);
  const summaryTokens = estimateMessage({ role: "user", content: [{ type: "text", text: framed }] });
  if (summaryTokens >= sourceTokens) return { ok: false, reason: "no-shrink" };
  return { ok: true, framed };
}

