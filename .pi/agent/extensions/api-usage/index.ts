import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";

const TIMEOUT_MS = 1200;
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
    fetch: (key?: string) => Promise<string | null>;
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
                    if (!adapter.local && !key) return null;
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
