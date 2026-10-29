import type { ExtensionAPI } from "@earendil-works/pi-coding-agent/dist/core/extensions/types.js";

const TIMEOUT_MS = 60_000;
const HEADLESS_TEXT =
  "asking unavailable in this non-interactive context; proceed with best judgment";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function textResult(text: string, isError = false): any {
  return {
    content: [{ type: "text", text }],
    isError,
  };
}

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ask_user_question",
    label: "Ask user question",
    description:
      "Ask the user a clarifying question with fixed options. " +
      "Use only when genuinely ambiguous between 2 or more viable paths and the choice changes what you will do. " +
      "Ask at most 1 question per turn. " +
      "Keep the question to one sentence and keep each option short (a few words).",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "Single-sentence question." },
        options: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 6,
          description: "2-6 short options.",
        },
        multi_select: {
          type: "boolean",
          default: false,
          description: "When true, the user may pick more than one option.",
        },
      },
      required: ["question", "options"],
      additionalProperties: false,
    } as never,
    async execute(_toolCallId, params: any, _signal, _onUpdate, ctx) {
      if (process.stdout.isTTY === false) {
        return textResult(HEADLESS_TEXT, true);
      }

      const question = typeof params?.question === "string" ? params.question.trim() : "";
      const options = Array.isArray(params?.options)
        ? params.options.filter((o: unknown): o is string => typeof o === "string").map((o: string) => o.trim()).filter(Boolean)
        : [];
      const multiSelect = params?.multi_select === true;

      if (!question) {
        return textResult("ask_user_question error: question must be a non-empty string.", true);
      }
      if (options.length < 2 || options.length > 6) {
        return textResult("ask_user_question error: options must contain 2-6 short strings.", true);
      }

      try {
        if (!multiSelect) {
          const picked = await withTimeout(ctx.ui.select(question, options, { timeout: TIMEOUT_MS }), TIMEOUT_MS + 1000);
          if (picked === undefined) {
            return textResult("ask_user_question timed out or was dismissed after 60s; proceed with best judgment.", true);
          }
          return textResult(`User selected: ${picked}`);
        }

        const picked: string[] = [];
        for (const option of options) {
          const yes = await withTimeout(
            ctx.ui.confirm(question, `Include "${option}"?`, { timeout: TIMEOUT_MS }),
            TIMEOUT_MS + 1000,
          );
          if (yes === undefined) {
            return textResult("ask_user_question timed out or was dismissed after 60s; proceed with best judgment.", true);
          }
          if (yes) picked.push(option);
        }
        if (picked.length === 0) {
          return textResult("User selected none of the options; proceed with best judgment.");
        }
        return textResult(`User selected: ${picked.join(", ")}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult(`ask_user_question failed (${message}); proceed with best judgment.`, true);
      }
    },
  });
}
