import type { ExtensionAPI } from "@earendil-works/pi-coding-agent/dist/core/extensions/types.js";

const DEFAULT_URL = "http://localhost:8888";
const MAX_RESULTS = 10;
const TIMEOUT_MS = 15_000;

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "searxng_web_search",
    label: "SearXNG web search",
    description: "Search the web through the private SearXNG instance and return ranked result titles, URLs, and snippets.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Web search query." },
        max_results: { type: "integer", minimum: 1, maximum: MAX_RESULTS, default: 5 },
      },
      required: ["query"],
      additionalProperties: false,
    } as never,
    async execute(_id, params: any, signal) {
      const query = typeof params?.query === "string" ? params.query.trim() : "";
      if (!query) return textResult("SearXNG search error: query must be a non-empty string.", true);
      const requested = Number.isInteger(params?.max_results) ? params.max_results : 5;
      const maxResults = Math.max(1, Math.min(MAX_RESULTS, requested));
      const base = (process.env.SEARXNG_URL ?? DEFAULT_URL).replace(/\/+$/, "");
      const search = new URLSearchParams({ q: query, format: "json", safesearch: "1" });
      // Bounded both ways: the caller's signal and a local timeout, so a hung or
      // unreachable instance cannot hold the model open indefinitely.
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        const response = await fetch(`${base}/search?${search.toString()}`, {
          headers: { Accept: "application/json" },
          signal: combined,
        });
        if (!response.ok) return textResult(`SearXNG search failed with HTTP ${response.status}.`, true);
        let data: unknown;
        try {
          data = await response.json();
        } catch {
          return textResult("SearXNG search error: response was not valid JSON (is `format=json` enabled on the instance?).", true);
        }
        if (!data || typeof data !== "object" || !Array.isArray((data as any).results)) {
          return textResult("SearXNG search error: response did not contain a results array.", true);
        }
        const results = ((data as any).results as any[]).filter(
          item => item && typeof item.title === "string" && typeof item.url === "string",
        );
        if (results.length === 0) return textResult("No SearXNG search results found.");
        return textResult(
          results
            .slice(0, maxResults)
            .map((item: any, index: number) => {
              const snippet = typeof item.content === "string" ? item.content.replace(/\s+/g, " ").trim() : "";
              return `${index + 1}. ${item.title}\n${item.url}${snippet ? `\n${snippet}` : ""}`;
            })
            .join("\n\n"),
        );
      } catch (error) {
        if (signal?.aborted) return textResult("SearXNG search cancelled.", true);
        if (timeout.aborted) return textResult(`SearXNG search timed out after ${TIMEOUT_MS / 1000}s.`, true);
        return textResult("SearXNG search failed due to a network or response error.", true);
      }
    },
  });
}
