/**
 * Keep Mistral requests under the model's per-request image cap.
 *
 * Pi replays every image still in the conversation on every request, and it
 * never prunes them. Mistral rejects a request once the total crosses the
 * model's cap ("Total number of images exceeds the maximum allowed of N",
 * code 3051), so a long session with screenshots fails permanently.
 *
 * Pi declares `inputLimits.images.maxPerRequest` in its model schema but never
 * enforces it, so this rewrites the outgoing payload instead: the newest images
 * are kept, older ones are dropped from that request only. Session history,
 * the transcript, exports, and token accounting are untouched.
 *
 * Observed caps on 2026-11-11: zai-glm-5-3-flash 8, deepseek-v4-1-flash-1017 20.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MISTRAL_API = "mistral-conversations";

/** Caps seen from the live API, for models whose catalogue entry lacks one. */
const OBSERVED_CAPS: Record<string, number> = {
  "zai-glm-5-3-flash": 8,
  "deepseek-v4-1-flash-1017": 20,
};

/** Keep one image fewer than the cap, in case the provider counts differently. */
const SAFETY_MARGIN = 1;

const OMITTED = "[image omitted: over the model's image limit]";

type Part = { type?: string } & Record<string, unknown>;
type Message = { role?: string; content?: string | Part[] } & Record<string, unknown>;
type Payload = { messages?: Message[] } & Record<string, unknown>;

/** Number of image parts across all messages of a Mistral payload. */
export function countImages(messages: Message[]): number {
  let total = 0;
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part?.type === "image_url") total += 1;
    }
  }
  return total;
}

/**
 * Drop the oldest images until at most `cap - SAFETY_MARGIN` remain.
 * Returns the original payload and a zero count when nothing needs dropping.
 */
export function trimImages(payload: Payload, cap: number): { payload: Payload; removed: number } {
  const messages = payload.messages;
  if (!Array.isArray(messages)) return { payload, removed: 0 };

  const keep = Math.max(0, cap - SAFETY_MARGIN);
  const positions: Array<{ message: number; part: number }> = [];
  messages.forEach((message, messageIndex) => {
    if (!Array.isArray(message.content)) return;
    message.content.forEach((part, partIndex) => {
      if (part?.type === "image_url") positions.push({ message: messageIndex, part: partIndex });
    });
  });

  if (positions.length <= keep) return { payload, removed: 0 };

  const dropped = new Set(
    positions.slice(0, positions.length - keep).map(({ message, part }) => `${message}:${part}`),
  );

  const next = messages.map((message, messageIndex) => {
    const content = message.content;
    if (!Array.isArray(content)) return message;
    const kept = content.filter((_part, partIndex) => !dropped.has(`${messageIndex}:${partIndex}`));
    if (kept.length === content.length) return message;
    // A message that held only images would otherwise become empty and invalid.
    return { ...message, content: kept.length > 0 ? kept : [{ type: "text", text: OMITTED }] };
  });

  return { payload: { ...payload, messages: next }, removed: dropped.size };
}

export default function mistralImageCap(pi: ExtensionAPI) {
  let announced = false;

  pi.on("session_start", async () => {
    announced = false;
  });

  pi.on("before_provider_request", (event, ctx) => {
    const model = ctx.model;
    if (!model || model.api !== MISTRAL_API) return;

    const cap = model.inputLimits?.images?.maxPerRequest ?? OBSERVED_CAPS[model.id];
    if (!cap || cap < 1) return;

    const result = trimImages(event.payload as Payload, cap);
    if (result.removed === 0) return;

    if (!announced) {
      announced = true;
      ctx.ui.notify(
        `Mistral image cap: dropped ${result.removed} older image(s) from the request (cap ${cap}). History is unchanged.`,
        "info",
      );
    }
    return result.payload;
  });
}
