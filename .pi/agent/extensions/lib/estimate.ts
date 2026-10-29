/**
 * Replay-aware token estimation, ported from DeepSeek Harness
 * `@deepseek-ai/dsh-token-meter` (`packages/llm/token-meter/src/estimate.ts`
 * and `surface-fold.ts`).
 *
 * DSH intentionally uses one fixed heuristic until exact tokenization is
 * needed. We reproduce it verbatim so the "context %" gauge and compaction
 * pressure share one deterministic price — and so the numbers are comparable
 * against the provider's reported usage (which is the ground truth for cache
 * accounting).
 *
 * Known limitation (inherited from DSH, documented there): a fixed 4
 * chars/token density underprices CJK text and JSON schemas badly. We treat
 * provider-reported usage as authoritative and this heuristic as the estimate
 * used for *scheduling* (when to compact), never for billing.
 */

/** Fixed text-density estimate used until exact tokenization is needed. */
export const CHARS_PER_TOKEN = 4;

/** Per-block structural overhead for JSON framing and type tags. */
export const BLOCK_OVERHEAD = 4;

/** Role-field framing overhead added to every priced message. */
export const ROLE_OVERHEAD = 4;

/** One block in a message. Mirrors the union DSH prices. */
export type DshContentBlock =
  | { type: 'text' | 'reasoning'; text: string }
  | { type: 'tool-call'; name: string; arguments: string }
  | { type: 'tool-result'; content: readonly DshContentBlock[] }
  | { type: string; [k: string]: unknown }; // merge-extensible default

/** The message shape we price: role + content blocks. */
export interface DshMessage {
  role: string;
  content: readonly DshContentBlock[];
}

/**
 * Price content blocks recursively under the fixed density heuristic.
 * This positional fold is deliberately not a durable SurfaceEvent model and
 * makes no route-specific image/file parity claim.
 * Faithful port of DSH `estimateContent`.
 */
export function estimateContent(blocks: readonly DshContentBlock[]): number {
  let tokens = 0;
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        tokens +=
          Math.ceil((block as { text: string }).text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
        break;
      case 'tool-call':
        tokens +=
          Math.ceil((block as { name: string }).name.length / CHARS_PER_TOKEN) +
          Math.ceil((block as { arguments: string }).arguments.length / CHARS_PER_TOKEN) +
          BLOCK_OVERHEAD;
        break;
      default:
        // Non-text blocks (including tool-result and reasoning extensions) are
        // structural JSON. Image offload is metadata, not part of its price.
        const structural = block.type === 'image'
          ? Object.fromEntries(Object.entries(block).filter(([key]) => key !== 'offloaded'))
          : block;
        tokens += BLOCK_OVERHEAD + Math.ceil(JSON.stringify(structural).length / CHARS_PER_TOKEN);
    }
  }
  return tokens;
}

/** Heuristically price one model-visible message. */
export function estimateMessage(message: DshMessage): number {
  if (message.role === 'system') {
    if (message.content.length === 0) return 0;
    const characters = message.content.reduce((sum, block) =>
      sum + (block.type === 'text' && typeof block.text === 'string'
        ? block.text.length
        : JSON.stringify(block).length), 0);
    return Math.ceil(characters / CHARS_PER_TOKEN) + ROLE_OVERHEAD;
  }
  return estimateContent(message.content) + ROLE_OVERHEAD;
}

/** Heuristically price a system prompt string (0 when absent). */
export function estimateSystem(tokens: string | undefined): number {
  if (tokens === undefined || tokens.length === 0) return 0;
  return Math.ceil(tokens.length / CHARS_PER_TOKEN) + ROLE_OVERHEAD;
}

/**
 * Heuristically price a serialized tool-schema list (0 when absent/empty).
 * Faithful port of DSH `estimateToolsTokens`.
 */
export function estimateTools(toolsJson: string | undefined): number {
  if (toolsJson === undefined || toolsJson.length === 0) return 0;
  return Math.ceil(toolsJson.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
}

/**
 * Heuristically price the complete non-surface request envelope.
 * Faithful port of DSH `estimateHeader` = system + tools.
 */
export function estimateHeader(system: string | undefined, toolsJson: string | undefined): number {
  return estimateSystem(system) + estimateTools(toolsJson);
}

/** One priced node on the conversation surface (positional). */
export interface DshSurfaceNode {
  seq: number;
  tokens: number;
}

/**
 * Result of folding one surface event onto a priced surface.
 * Faithful port of DSH `SurfaceTokenFold`.
 */
export interface DshSurfaceFold {
  /** Heuristic price of the event's own message; 0 when it derives none. */
  tokens: number;
  /** The surface after the event, detached from the input. */
  nodes: DshSurfaceNode[];
  /** Signed change in the surface total: `tokens` minus anything shadowed. */
  deltaTokens: number;
}

/** Minimal surface-op discriminator DSH's fold switches on. */
export type DshSurfaceOp =
  | { op: 'append' }
  | { op: 'replace'; start: number; end: number };

/** A surface event with enough shape for the fold. */
export interface DshSurfaceEvent {
  seq: number;
  surfaceOp: DshSurfaceOp;
  /** The message this event derives, or null if none. */
  message: DshMessage | null;
}

/**
 * Fold one surface event onto a priced surface (allocation-fresh; throws leave
 * the caller's state untouched, matching DSH).
 *
 * Faithful port of DSH `foldSurfaceTokens`.
 */
export function foldSurfaceTokens(
  nodes: readonly DshSurfaceNode[],
  event: DshSurfaceEvent,
): DshSurfaceFold {
  const tokens = event.message === null ? 0 : estimateMessage(event.message);
  const op = event.surfaceOp;
  if (op.op === 'append') {
    return {
      tokens,
      nodes: [...nodes, { seq: event.seq, tokens }],
      deltaTokens: tokens,
    };
  }
  const startIdx = nodes.findIndex((node) => node.seq === op.start);
  const endIdx = nodes.findIndex((node) => node.seq === op.end);
  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
    throw new Error(
      `token surface: replace at seq ${event.seq} has invalid current range ${op.start}-${op.end}`,
    );
  }
  const removed = nodes
    .slice(startIdx, endIdx + 1)
    .reduce((total, node) => total + node.tokens, 0);
  const next = [...nodes];
  next.splice(startIdx, endIdx - startIdx + 1, { seq: event.seq, tokens });
  return { tokens, nodes: next, deltaTokens: tokens - removed };
}

/** Convenience total over a priced surface. */
export function surfaceTotal(nodes: readonly DshSurfaceNode[]): number {
  return nodes.reduce((t, n) => t + n.tokens, 0);
}
