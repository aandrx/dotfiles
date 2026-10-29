import type { ExtensionAPI } from "@earendil-works/pi-coding-agent/dist/core/extensions/types.js";

const API_URL = "https://api.tavily.com/search";
const EXTRACT_API_URL = "https://api.tavily.com/extract";
const MAX_RESULTS = 10;
const MAX_EXTRACT_URLS = 5;

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "tavily_web_search",
    label: "Tavily web search",
    description: "Search the web with Tavily and return ranked result titles, URLs, and snippets.",
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
      const apiKey = process.env.TAVILY_API_KEY;
      if (!apiKey) return textResult("Tavily search unavailable: set TAVILY_API_KEY in the environment before launching Pi.", true);
      const query = typeof params?.query === "string" ? params.query.trim() : "";
      if (!query) return textResult("Tavily search error: query must be a non-empty string.", true);
      const requested = Number.isInteger(params?.max_results) ? params.max_results : 5;
      const maxResults = Math.max(1, Math.min(MAX_RESULTS, requested));
      try {
        const response = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults, search_depth: "basic" }),
          signal,
        });
        if (!response.ok) return textResult(`Tavily search failed with HTTP ${response.status}.`, true);
        const data: unknown = await response.json();
        if (!data || typeof data !== "object" || !Array.isArray((data as any).results)) {
          return textResult("Tavily search error: response did not contain a results array.", true);
        }
        const results = (data as any).results;
        if (!results.every((item: any) => item && typeof item.title === "string" && typeof item.url === "string" && typeof item.content === "string")) {
          return textResult("Tavily search error: response contained an invalid result.", true);
        }
        if (results.length === 0) return textResult("No Tavily search results found.");
        return textResult(results.slice(0, maxResults).map((item: any, index: number) => `${index + 1}. ${item.title}\n${item.url}\n${item.content}`).join("\n\n"));
      } catch (error) {
        if (signal?.aborted) return textResult("Tavily search cancelled.", true);
        return textResult("Tavily search failed due to a network or response error.", true);
      }
    },
  });

  pi.registerTool({
    name: "tavily_web_extract",
    label: "Tavily web extract",
    description: "Extract readable page content from up to five HTTP(S) URLs using Tavily.",
    parameters: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: 1,
          maxItems: MAX_EXTRACT_URLS,
          description: `URLs to extract (1-${MAX_EXTRACT_URLS}); HTTP(S) only.`,
        },
      },
      required: ["urls"],
      additionalProperties: false,
    } as never,
    async execute(_id, params: any, signal) {
      const apiKey = process.env.TAVILY_API_KEY;
      if (!apiKey) return textResult("Tavily extract unavailable: set TAVILY_API_KEY in the environment before launching Pi.", true);
      const urls = params?.urls;
      if (!Array.isArray(urls) || urls.length < 1 || urls.length > MAX_EXTRACT_URLS) {
        return textResult(`Tavily extract error: provide between 1 and ${MAX_EXTRACT_URLS} URLs.`, true);
      }
      for (const value of urls) {
        if (typeof value !== "string") return textResult("Tavily extract error: every URL must be a valid HTTP(S) URL.", true);
        try {
          const parsed = new URL(value);
          if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) throw new Error();
        } catch {
          return textResult("Tavily extract error: every URL must be a valid HTTP(S) URL.", true);
        }
      }
      try {
        const response = await fetch(EXTRACT_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: apiKey, urls }),
          signal,
        });
        if (!response.ok) return textResult(`Tavily extract failed with HTTP ${response.status}.`, true);
        const data: unknown = await response.json();
        if (!data || typeof data !== "object" || !Array.isArray((data as any).results) || !Array.isArray((data as any).failed_results)) {
          return textResult("Tavily extract error: response did not contain valid results and failed_results arrays.", true);
        }
        const results = (data as any).results;
        const failures = (data as any).failed_results;
        if (!results.every((item: any) => item && typeof item.url === "string" && typeof item.raw_content === "string") ||
            !failures.every((item: any) => item && typeof item.url === "string")) {
          return textResult("Tavily extract error: response contained an invalid result.", true);
        }
        const sections = results.map((item: any) => `Source: ${item.url}\n\n${item.raw_content}`);
        for (const item of failures) sections.push(`Failed to extract: ${item.url}`);
        return textResult(sections.length ? sections.join("\n\n---\n\n") : "Tavily could not extract content from the requested URLs.", failures.length > 0 && results.length === 0);
      } catch (error) {
        if (signal?.aborted) return textResult("Tavily extract cancelled.", true);
        return textResult("Tavily extract failed due to a network or response error.", true);
      }
    },
  });
}
