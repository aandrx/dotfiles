import type { ExtensionAPI } from "@earendil-works/pi-coding-agent/dist/core/extensions/types.js";

// Exa's hosted MCP endpoint. It is keyless by default (the same free endpoint
// hosted MCP); an `EXA_API_KEY` is only appended when one is present.
// `EXA_MCP_URL` exists so tests can point at a local server.
const DEFAULT_MCP_URL = "https://mcp.exa.ai/mcp";
const TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RESULTS = 20;
const MAX_OBJECTIVE_CHARS = 4096;
const MAX_FETCH_URLS = 5;
const MAX_FETCH_CHARS = 50_000;

export type ExaOutcome = { text?: string; error?: string };

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

export function buildEndpoint(baseUrl: string = process.env.EXA_MCP_URL ?? DEFAULT_MCP_URL): string {
  const key = process.env.EXA_API_KEY?.trim();
  if (!key) return baseUrl;
  const url = new URL(baseUrl);
  url.searchParams.set("exaApiKey", key);
  return url.toString();
}

/** Exa's hosted MCP answers either as plain JSON or as an SSE `data:` stream;
 *  both wrap the same JSON-RPC payload. Returns the first usable content block. */
export function parseExaResponse(raw: string): ExaOutcome {
  const candidates: string[] = [];
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) candidates.push(trimmed);
  for (const line of raw.split("\n")) {
    const value = line.trim();
    if (value.startsWith("data: ")) candidates.push(value.slice(6));
  }
  for (const candidate of candidates) {
    let parsed: any;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (parsed?.error) {
      const message = typeof parsed.error?.message === "string" ? parsed.error.message : "unknown error";
      return { error: `Exa MCP error: ${message}` };
    }
    const content = parsed?.result?.content;
    if (!Array.isArray(content)) continue;
    const block = content.find((entry: any) => entry && typeof entry.text === "string" && entry.text.trim());
    if (!block) continue;
    if (parsed.result.isError) return { error: `Exa MCP error: ${block.text.trim()}` };
    return { text: block.text };
  }
  return { error: "Exa MCP returned no usable content." };
}

async function readBounded(response: Response, limit: number): Promise<string | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function callExaTool(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ExaOutcome> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetch(buildEndpoint(), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      signal: combined,
    });
    if (!response.ok) return { error: `Exa request failed with HTTP ${response.status}.` };
    const raw = await readBounded(response, MAX_RESPONSE_BYTES);
    if (raw === undefined) return { error: "Exa response exceeded the size limit." };
    return parseExaResponse(raw);
  } catch {
    if (signal?.aborted) return { error: "Exa request cancelled." };
    if (timeout.aborted) return { error: `Exa request timed out after ${TIMEOUT_MS / 1000}s.` };
    return { error: "Exa request failed due to a network, timeout, or response error." };
  }
}

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "exa_web_search",
    label: "Exa web search",
    description:
      "Search the web through Exa's hosted MCP and return clean result titles, URLs, and highlights. Keyless by default.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, description: "Natural-language search query describing the ideal page." },
        objective: {
          type: "string",
          minLength: 1,
          maxLength: MAX_OBJECTIVE_CHARS,
          description: "What to rank first and which facts to pull; defaults to a relevance-focused objective for the query.",
        },
        max_results: { type: "integer", minimum: 1, maximum: MAX_RESULTS, default: 8, description: "Number of results to return." },
      },
      required: ["query"],
      additionalProperties: false,
    } as never,
    async execute(_id, params: any, signal) {
      const query = typeof params?.query === "string" ? params.query.trim() : "";
      if (!query) return textResult("Exa search error: query must be a non-empty string.", true);
      const requested = Number.isInteger(params?.max_results) ? params.max_results : 8;
      const maxResults = Math.max(1, Math.min(MAX_RESULTS, requested));
      const objective =
        typeof params?.objective === "string" && params.objective.trim()
          ? params.objective.trim().slice(0, MAX_OBJECTIVE_CHARS)
          : `Return the most relevant, authoritative, and current sources for: ${query}`;
      const outcome = await callExaTool("web_search_exa", { query, objective, numResults: maxResults }, signal);
      if (outcome.error) return textResult(outcome.error, true);
      return textResult(outcome.text ?? "No Exa search results found.");
    },
  });

  pi.registerTool({
    name: "exa_web_fetch",
    label: "Exa web fetch",
    description:
      "Read 1-5 public HTTP(S) URLs as clean markdown through Exa's hosted MCP; Exa's crawler can render many JavaScript-dependent pages. Keyless by default.",
    parameters: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: 1,
          maxItems: MAX_FETCH_URLS,
          description: "URLs to read; batch multiple URLs in one call.",
        },
        max_characters: {
          type: "integer",
          minimum: 1,
          maximum: MAX_FETCH_CHARS,
          default: 3000,
          description: "Maximum characters to extract per page.",
        },
      },
      required: ["urls"],
      additionalProperties: false,
    } as never,
    async execute(_id, params: any, signal) {
      const urls = params?.urls;
      if (
        !Array.isArray(urls) ||
        urls.length < 1 ||
        urls.length > MAX_FETCH_URLS ||
        !urls.every((value: any) => typeof value === "string" && value.length > 0 && value.length <= 2048)
      ) {
        return textResult("Exa fetch error: provide 1-5 URLs, each at most 2048 characters.", true);
      }
      for (const value of urls) {
        try {
          const url = new URL(value);
          if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("invalid");
        } catch {
          return textResult("Exa fetch error: each URL must be HTTP(S), without credentials.", true);
        }
      }
      const requested = Number.isInteger(params?.max_characters) ? params.max_characters : 3000;
      const maxCharacters = Math.max(1, Math.min(MAX_FETCH_CHARS, requested));
      const outcome = await callExaTool("web_fetch_exa", { urls, maxCharacters }, signal);
      if (outcome.error) return textResult(outcome.error, true);
      return textResult(outcome.text ?? "No Exa fetch content returned.");
    },
  });
}
