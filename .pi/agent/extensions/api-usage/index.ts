import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from "node:fs";
import { execSync, spawn } from "node:child_process";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";

const TIMEOUT_MS = 1200;
const CODEX_TIMEOUT_MS = 6000;
const MISTRAL_TIMEOUT_MS = 4000;
const AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");
const CACHE_PATH = join(homedir(), ".pi", "agent", "api-usage.cache");

function hasActiveInterface() {
    const ifs = networkInterfaces();
    for (const entries of Object.values(ifs)) {
        if (entries?.some((e) => e && !e.internal && (e.address))) return true;
    }
    return false;
}

function writeCache(text: string) {
    const tmp = `${CACHE_PATH}.tmp`;
    try {
        writeFileSync(tmp, text, "utf8");
        renameSync(tmp, CACHE_PATH);
    } catch (e) {
        // fail silently on cache write
    }
}

async function getText(url: string, headers: Record<string, string>) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), MISTRAL_TIMEOUT_MS);
    try {
        const res = await fetch(url, { headers, signal: ctrl.signal, redirect: "follow" });
        if (!res.ok) return null;
        return { text: await res.text(), finalUrl: res.url };
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/** Firefox profile directory that owns a cookies database, or null. */
function firefoxProfile(): string | null {
    const root = join(homedir(), ".mozilla", "firefox");
    const profiles: string[] = [];
    try {
        const ini = readFileSync(join(root, "profiles.ini"), "utf8");
        for (const match of ini.matchAll(/^Path=(.+)$/gm)) profiles.push(match[1].trim());
    } catch {
        // fall back to a directory scan
    }
    try {
        for (const entry of readdirSync(root)) profiles.push(entry);
    } catch {
        // no Firefox install
    }
    for (const profile of profiles) {
        const dir = join(root, profile);
        if (existsSync(join(dir, "cookies.sqlite"))) return dir;
    }
    return null;
}

/**
 * Mistral exposes no usage API below Enterprise, so the admin panel's own
 * session is used: the ory_session and csrf cookies from the browser. Override
 * with MISTRAL_COOKIE (a full Cookie header) when Firefox is not the browser.
 */
function mistralCookieHeader(): string | null {
    const manual = process.env.MISTRAL_COOKIE?.trim();
    if (manual) return manual;

    const profile = firefoxProfile();
    if (!profile) return null;
    const db = join(profile, "cookies.sqlite");
    try {
        const out = execSync(
            `sqlite3 "file:${db}?immutable=1" "select name || '=' || value from moz_cookies where host = '.mistral.ai' and (name like 'ory_session%' or name like 'csrf_token%') order by lastAccessed desc;"`,
            { encoding: "utf8", timeout: 1500 },
        ).trim();
        const pairs = out.split("\n").filter((line) => line.includes("="));
        return pairs.length > 0 ? pairs.join("; ") : null;
    } catch {
        return null;
    }
}

/** Reads "Included <label> usage ... $used $total" from the subscription page. */
function parseAllowance(text: string, label: string) {
    const index = text.indexOf(label);
    if (index === -1) return null;
    const match = text.slice(index, index + 400).match(/\$([\d,]+(?:\.\d+)?)\s*\$([\d,]+(?:\.\d+)?)/);
    if (!match) return null;
    return { used: match[1], total: match[2] };
}

async function getJson(url: string, key: string) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, { 
            headers: { "Authorization": `Bearer ${key}` }, 
            signal: ctrl.signal 
        });
        if (!res.ok) return null;
        return await res.json();
    } catch { 
        return null; 
    } finally { 
        clearTimeout(timer); 
    }
}

interface Adapter {
    enabled: boolean;
    /** Local-only adapters skip the auth key requirement and network-interface gate. */
    local?: boolean;
    /** Adapters that authenticate outside Pi (e.g. a CLI's own login) skip the key lookup. */
    noAuth?: boolean;
    fetch: (key?: string) => Promise<string | null>;
}

interface CodexWindow {
    usedPercent?: number;
    windowDurationMins?: number;
    resetsAt?: number;
}

interface CodexRateLimitsResult {
    rateLimits?: {
        primary?: CodexWindow;
        secondary?: CodexWindow;
        rateLimitReachedType?: string | null;
    };
    rateLimitResetCredits?: { availableCount?: number };
}

/**
 * Reads ChatGPT/Codex plan windows from the Codex app-server over stdio: primary is the
 * 5-hour window, secondary the weekly window. Uses the CLI's own login, so no Pi key.
 * Starting the app-server costs ~0.6s, all of it off the startup path.
 */
function readCodexRateLimits(): Promise<CodexRateLimitsResult | null> {
    return new Promise((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let child: ReturnType<typeof spawn> | undefined;

        const finish = (value: CodexRateLimitsResult | null) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            try {
                child?.kill("SIGKILL");
            } catch {
                // already gone
            }
            resolve(value);
        };

        try {
            child = spawn("codex", ["app-server", "--listen", "stdio://"], {
                stdio: ["pipe", "pipe", "ignore"],
            });
        } catch {
            resolve(null);
            return;
        }

        timer = setTimeout(() => finish(null), CODEX_TIMEOUT_MS);
        child.on("error", () => finish(null));
        child.on("exit", () => finish(null));

        const send = (message: unknown) => {
            try {
                child?.stdin?.write(`${JSON.stringify(message)}\n`);
            } catch {
                finish(null);
            }
        };

        let pending = "";
        child.stdout?.on("data", (chunk: Buffer) => {
            pending += chunk.toString("utf8");
            const lines = pending.split("\n");
            pending = lines.pop() ?? "";
            for (const line of lines) {
                if (!line.trim()) continue;
                let message: any;
                try {
                    message = JSON.parse(line);
                } catch {
                    continue;
                }
                if (message?.id !== 1) continue;
                finish(message.result ?? null);
                return;
            }
        });

        send({ jsonrpc: "2.0", id: 0, method: "initialize", params: { clientInfo: { name: "pi", version: "api-usage" } } });
        send({ jsonrpc: "2.0", method: "initialized", params: {} });
        send({ jsonrpc: "2.0", id: 1, method: "account/rateLimits/read", params: {} });
    });
}

function clampPercent(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return Math.round(Math.min(Math.max(value, 0), 100));
}

function fmtTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
    return `${n}`;
}

const ADAPTERS: Record<string, Adapter> = {
    openrouter: {
        enabled: true,
        async fetch(key) {
            const [keyInfo, creditsInfo] = await Promise.all([
                getJson("https://openrouter.ai/api/v1/key", key),
                getJson("https://openrouter.ai/api/v1/credits", key),
            ]);
            const data = keyInfo?.data;
            if (!data) return null;
            const parts: string[] = [];
            parts.push(`openrouter $${(data.usage ?? 0).toFixed(2)} used`);
            if (data.is_free_tier) parts.push("free tier");
            const totalCredits = creditsInfo?.data?.total_credits;
            if (typeof totalCredits === "number") {
                parts.push(`$${totalCredits.toFixed(2)} credits`);
            }
            return parts.join(" · ");
        },
    },
    "ollama-cloud": {
        enabled: true,
        async fetch(key) {
            const data = await getJson("https://ollama.com/api/usage", key);
            if (!data || typeof data !== "object") return null;
            const limits = (data as any).limits;
            if (!limits?.session?.usage || !limits.weekly?.usage) return null;
            const sessionPct = Math.round(Math.min(Math.max((limits.session.usage as number) * 100, 0), 100));
            const weeklyPct = Math.round(Math.min(Math.max((limits.weekly.usage as number) * 100, 0), 100));
            const cost = typeof data.activity?.cost === "string" ? data.activity.cost : null;
            const parts = [`ollama-cloud ${sessionPct}% session · ${weeklyPct}% week`];
            if (cost !== null) parts.push(`$${cost}`);
            return parts.join(" · ");
        },
    },
    codex: {
        enabled: true,
        noAuth: true,
        async fetch() {
            const data = await readCodexRateLimits();
            const limits = data?.rateLimits;
            if (!limits) return null;

            const sessionPct = clampPercent(limits.primary?.usedPercent);
            const weeklyPct = clampPercent(limits.secondary?.usedPercent);
            if (sessionPct === null && weeklyPct === null) return null;

            const parts: string[] = [];
            if (sessionPct !== null) parts.push(`${sessionPct}% 5h`);
            if (weeklyPct !== null) parts.push(`${weeklyPct}% week`);
            if (limits.rateLimitReachedType) parts.push("limit reached");
            const resets = data?.rateLimitResetCredits?.availableCount;
            if (typeof resets === "number" && resets > 0) {
                parts.push(`${resets} reset${resets === 1 ? "" : "s"}`);
            }
            return `codex ${parts.join(" · ")}`;
        },
    },
    "opencode-go": {
        enabled: true,
        async fetch(key) {
            const data = await getJson("https://opencode.ai/zen/go/v1/usage", key);
            const usage = data?.usage;
            if (!usage || typeof usage !== "object") return null;

            const parts: string[] = [];
            for (const [label, window] of [
                ["5h", usage.rolling],
                ["week", usage.weekly],
                ["month", usage.monthly],
            ] as const) {
                const pct = clampPercent((window as { percent?: number } | undefined)?.percent);
                if (pct !== null) parts.push(`${pct}% ${label}`);
            }
            if (parts.length === 0) return null;
            return `opencode-go ${parts.join(" · ")}`;
        },
    },
    mistral: {
        enabled: true,
        noAuth: true,
        async fetch() {
            const cookie = mistralCookieHeader();
            if (!cookie) return null;

            const page = await getText("https://admin.mistral.ai/subscription", {
                Cookie: cookie,
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36",
                Accept: "text/html",
            });
            if (!page || !page.finalUrl.startsWith("https://admin.mistral.ai/")) return null;

            const text = page.text.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
            const api = parseAllowance(text, "Included API usage");
            const vibe = parseAllowance(text, "Included Vibe Code usage");
            if (!api && !vibe) return null;

            const parts: string[] = [];
            if (api) parts.push(`$${api.used}/$${api.total} api`);
            if (vibe) parts.push(`$${vibe.used}/$${vibe.total} vibe`);
            return `mistral ${parts.join(" · ")}`;
        },
    },
    omniroute: {
        enabled: true,
        local: true,
        async fetch() {
            const dbPath = join(homedir(), ".omniroute", "storage.sqlite");
            if (!existsSync(dbPath)) return null;
            try {
                const agg = execSync(
                    `sqlite3 "${dbPath}" "SELECT SUM(tokens_input+tokens_output) || '|' || COUNT(*) FROM usage_history WHERE timestamp > datetime('now','-24 hours');"`,
                    { encoding: "utf8", timeout: 1500 }
                ).trim();
                const [tokStr, reqStr] = agg.split("|");
                const tok = parseInt(tokStr || "0", 10);
                const req = parseInt(reqStr || "0", 10);
                if (req === 0) return null;
                const prov = execSync(
                    `sqlite3 "${dbPath}" "SELECT provider || '|' || SUM(tokens_input+tokens_output) FROM usage_history WHERE timestamp > datetime('now','-24 hours') GROUP BY provider ORDER BY SUM(tokens_input+tokens_output) DESC LIMIT 3;"`,
                    { encoding: "utf8", timeout: 1500 }
                ).trim();
                const provParts = prov
                    .split("\n")
                    .filter(Boolean)
                    .map((line) => {
                        const [p, t] = line.split("|");
                        const v = parseInt(t || "0", 10);
                        if (!p || v === 0) return null;
                        return `${p} ${fmtTokens(v)}`;
                    })
                    .filter((x): x is string => x !== null);
                const parts = [`omniroute ${fmtTokens(tok)} tokens`, `${req} req`];
                if (provParts.length > 0) parts.push(...provParts);
                return parts.join(" · ");
            } catch {
                return null;
            }
        },
    },
};

export default async function (pi: ExtensionAPI) {
    // Escape hatch for testing or manual override
    if (process.env.PI_API_USAGE_OFFLINE === "1") {
        return;
    }

    // Background refresh: schedules the fetch to run AFTER startup completes (no blocking).
    // This eliminates startup delay and ensures a smooth launch.
    setTimeout(async () => {
        const hasLocal = Object.values(ADAPTERS).some((a) => a.local && a.enabled);
        if (!hasActiveInterface() && !hasLocal) return;

        try {
            let auth: any = {};
            try {
                auth = JSON.parse(readFileSync(AUTH_PATH, "utf8"));
            } catch {
                return;
            }

            const results = await Promise.all(
                Object.entries(ADAPTERS).map(async ([provider, adapter]) => {
                    if (!adapter.enabled) return null;
                    const key = auth[provider]?.key;
                    if (!adapter.local && !adapter.noAuth && !key) return null;
                    return adapter.fetch(key);
                })
            );

            const lines = results.filter((line): line is string => typeof line === "string");
            if (lines.length > 0) {
                writeCache(lines.join("\n"));
            }
        } catch {
            // Background failures are silent to avoid disturbing the TUI
        }
    }, 2000); // Deferred slightly to avoid competing with startup I/O
}
