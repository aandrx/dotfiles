/**
 * exa-search tests.
 *
 * Offline: pure helpers plus a local HTTP server standing in for Exa's MCP
 * endpoint. No network, no secrets, no cost.
 *
 * Run from ~/.pi/agent/extensions/:
 *   node --test exa-search.test.ts
 *
 * NOTE: pi auto-discovers *.ts in this dir, so this file default-exports a
 * no-op extension and only registers tests when run as the entry point.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";

import { buildEndpoint, parseExaResponse, callExaTool } from "../exa-search.ts";

const isMain = !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (!isMain) {
  // Loaded by pi as an extension — do not register tests.
} else {
  test("buildEndpoint: keyless base by default", () => {
    const saved = { url: process.env.EXA_MCP_URL, key: process.env.EXA_API_KEY };
    try {
      delete process.env.EXA_MCP_URL;
      delete process.env.EXA_API_KEY;
      assert.equal(buildEndpoint(), "https://mcp.exa.ai/mcp");
      assert.equal(buildEndpoint("http://127.0.0.1:9/mcp"), "http://127.0.0.1:9/mcp");
    } finally {
      if (saved.url === undefined) delete process.env.EXA_MCP_URL;
      else process.env.EXA_MCP_URL = saved.url;
      if (saved.key === undefined) delete process.env.EXA_API_KEY;
      else process.env.EXA_API_KEY = saved.key;
    }
  });

  test("buildEndpoint: appends exaApiKey when EXA_API_KEY is set", () => {
    const saved = { url: process.env.EXA_MCP_URL, key: process.env.EXA_API_KEY };
    try {
      delete process.env.EXA_MCP_URL;
      process.env.EXA_API_KEY = "secret key/with?chars";
      assert.equal(buildEndpoint(), "https://mcp.exa.ai/mcp?exaApiKey=secret+key%2Fwith%3Fchars");
    } finally {
      if (saved.url === undefined) delete process.env.EXA_MCP_URL;
      else process.env.EXA_MCP_URL = saved.url;
      if (saved.key === undefined) delete process.env.EXA_API_KEY;
      else process.env.EXA_API_KEY = saved.key;
    }
  });

  test("parseExaResponse: SSE data line", () => {
    const raw = 'event: message\ndata: {"result":{"content":[{"type":"text","text":"Title: X\\nURL: https://x"}]},"jsonrpc":"2.0","id":1}\n\n';
    assert.deepEqual(parseExaResponse(raw), { text: "Title: X\nURL: https://x" });
  });

  test("parseExaResponse: plain JSON body", () => {
    const raw = '{"result":{"content":[{"type":"text","text":"plain"}]},"jsonrpc":"2.0","id":1}';
    assert.deepEqual(parseExaResponse(raw), { text: "plain" });
  });

  test("parseExaResponse: JSON-RPC error", () => {
    const raw = 'data: {"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"bad tool"}}';
    assert.deepEqual(parseExaResponse(raw), { error: "Exa MCP error: bad tool" });
  });

  test("parseExaResponse: tool-level isError", () => {
    const raw = 'data: {"result":{"content":[{"type":"text","text":"MCP error -32602: nope"}],"isError":true},"jsonrpc":"2.0","id":1}';
    assert.deepEqual(parseExaResponse(raw), { error: "Exa MCP error: MCP error -32602: nope" });
  });

  test("parseExaResponse: unusable body", () => {
    assert.deepEqual(parseExaResponse("not json at all"), { error: "Exa MCP returned no usable content." });
    assert.deepEqual(parseExaResponse(""), { error: "Exa MCP returned no usable content." });
  });

  async function withServer(
    handler: (body: string) => { status?: number; contentType?: string; body: string },
    run: (base: string) => Promise<void>,
  ): Promise<void> {
    const server: Server = createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const out = handler(body);
        res.writeHead(out.status ?? 200, { "content-type": out.contentType ?? "application/json" });
        res.end(out.body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const saved = process.env.EXA_MCP_URL;
    process.env.EXA_MCP_URL = `http://127.0.0.1:${address.port}/mcp`;
    try {
      await run(process.env.EXA_MCP_URL);
    } finally {
      if (saved === undefined) delete process.env.EXA_MCP_URL;
      else process.env.EXA_MCP_URL = saved;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  test("callExaTool: posts JSON-RPC tools/call and parses SSE", async () => {
    await withServer(
      (body) => {
        const parsed = JSON.parse(body);
        assert.equal(parsed.method, "tools/call");
        assert.equal(parsed.params.name, "web_search_exa");
        assert.deepEqual(parsed.params.arguments, { query: "q", objective: "o", numResults: 3 });
        return {
          contentType: "text/event-stream",
          body: `event: message\ndata: ${JSON.stringify({ result: { content: [{ type: "text", text: "hit" }] }, jsonrpc: "2.0", id: 1 })}\n\n`,
        };
      },
      async () => {
        const outcome = await callExaTool("web_search_exa", { query: "q", objective: "o", numResults: 3 });
        assert.deepEqual(outcome, { text: "hit" });
      },
    );
  });

  test("callExaTool: HTTP failure surfaces status", async () => {
    await withServer(
      () => ({ status: 503, body: "nope" }),
      async () => {
        assert.deepEqual(await callExaTool("web_search_exa", {}), { error: "Exa request failed with HTTP 503." });
      },
    );
  });

  test("callExaTool: network failure is reported, not thrown", async () => {
    const saved = process.env.EXA_MCP_URL;
    process.env.EXA_MCP_URL = "http://127.0.0.1:1/mcp";
    try {
      const outcome = await callExaTool("web_search_exa", {});
      assert.ok(outcome.error && outcome.error.startsWith("Exa request failed"));
    } finally {
      if (saved === undefined) delete process.env.EXA_MCP_URL;
      else process.env.EXA_MCP_URL = saved;
    }
  });
}
