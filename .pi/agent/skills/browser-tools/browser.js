#!/usr/bin/env node
// Consolidated Firefox browser automation CLI (WebDriver BiDi).
// Runs against a dedicated, isolated Firefox instance on its own port/profile.
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync, spawn } from "node:child_process";
import puppeteer from "puppeteer-core";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const PORT = process.env.PI_BROWSER_PORT || "9222";
const WS = `ws://127.0.0.1:${PORT}/session`;
const SCRAPING_DIR = join(homedir(), ".cache", "browser-tools");
const PROFILE = join(SCRAPING_DIR, "firefox-profile");

function die(msg) {
  console.error(msg);
  process.exit(1);
}
function usage() {
  console.log(`Usage: browser.js <cmd> [args]
  start [--headless]      Launch/attach the dedicated Firefox instance
  stop                    Stop only the dedicated instance (never your normal Firefox)
  status                  Show instance + page state
  nav <url> [--new] [--reload]
  eval '<js>'             Run JS in the active tab (async context)
  screenshot [--path F]   Save a screenshot
  cookies                 List cookies for the active tab
  content <url>           Extract readable page text as markdown
  pick '<instruction>'    Interactive: user clicks elements, returns selectors`);
  process.exit(0);
}

async function connect() {
  const b = await puppeteer.connect({
    browserWSEndpoint: WS,
    protocol: "webDriverBiDi",
  });
  return b;
}

async function activePage(b) {
  const pages = await b.pages();
  return pages[pages.length - 1] || (await b.newPage());
}

function printResult(r) {
  const rows = (o) => Object.entries(o).map(([k, v]) => `${k}: ${v}`).join("\n");
  if (Array.isArray(r)) console.log(r.map((o) => rows(o)).join("\n\n"));
  else if (r && typeof r === "object") console.log(rows(r));
  else console.log(r);
}

async function ensureBrowser() {
  try {
    return await connect();
  } catch {
    await startBrowser(false);
    return await connect();
  }
}

async function startBrowser(headless) {
  try {
    const b = await connect(); // already running -> reuse
    await b.disconnect();
    console.log(`instance already running on :${PORT}`);
    return;
  } catch {}

  mkdirSync(PROFILE, { recursive: true });
  // Self-heal the wedge: BiDi unreachable but a profile process still alive (its
  // endpoint is dead and a fresh spawn would just hit the profile lock dialog).
  // Reap it first so the spawn below gets a clean profile. A healthy instance
  // never reaches here (connect() above already reused it).
  try {
    const strays = execSync(`pgrep -f "firefox-profile" 2>/dev/null || true`).toString().trim();
    if (strays) {
      console.log(`reaping wedged instance: ${strays.split("\n").join(" ")}`);
      execSync(`pkill -f "firefox-profile" 2>/dev/null || true`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  } catch {}
  const lock = join(SCRAPING_DIR, "SingletonLock");
  for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie"])
    try { execSync(`rm -f "${join(PROFILE, f)}"`); } catch {}

  const bin = (process.env.PI_BROWSER || "firefox").trim();
  spawn(bin, [
    "--remote-debugging-port", PORT,
    "--remote-allow-origins", "*",
    "-profile", PROFILE,
    "-new-instance", "-no-remote",
    ...(headless ? ["--headless"] : []),
  ], { detached: true, stdio: "ignore" }).unref();

  for (let i = 0; i < 40; i++) {
    try { const b = await connect(); await b.disconnect(); return; }
    catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  die(`failed to start Firefox on :${PORT} (set PI_BROWSER to the binary, or PI_BROWSER_PORT)`);
}

function stopBrowser() {
  // Kill ONLY processes referencing our dedicated profile dir. This dir is unique to this
  // isolated instance, so the user's normal Firefox (different profile) is never touched.
  const out = execSync(`pgrep -f "firefox-profile" 2>/dev/null || true`).toString().trim();
  let killed = 0;
  for (const pid of out.split("\n")) {
    if (!pid) continue;
    try { process.kill(pid); killed++; } catch {}
  }
  if (killed) {
    // Let children notice the death, then reap stragglers (e.g. content processes).
    setTimeout(() => { try { execSync(`pkill -f "firefox-profile" 2>/dev/null || true`); } catch {} }, 800);
    console.log(`stopped ${killed} dedicated process(es)`);
  } else console.log("no dedicated instance running");
}

async function cmdStatus() {
  const b = await connect();
  const p = await activePage(b);
  console.log(`url:      ${p.url()}`);
  console.log(`title:    ${await p.title()}`);
  await b.disconnect();
}

async function cmdNav(url, opts) {
  if (!url) usage();
  const b = await ensureBrowser();
  const p = opts.new ? await b.newPage() : await activePage(b);
  await p.goto(url, { waitUntil: "domcontentloaded" });
  if (opts.reload) await p.reload({ waitUntil: "domcontentloaded" });
  console.log((opts.new ? "opened" : "navigated") + " to:", url);
  await b.disconnect();
}

async function cmdEval(code) {
  if (!code) usage();
  const b = await ensureBrowser();
  const p = await activePage(b);
  // Prefer a single expression (returns its value); fall back to statement(s)
  // so callers can run code with semicolons, e.g. "a = 1; b = 2".
  const r = await p.evaluate((c) => {
    const run = (src) => {
      try {
        return new Function(`return (${src})`)();
      } catch {
        // Statement(s) - eval them as a program so the last expression is the result.
        return new Function(`return eval(${JSON.stringify(src)})`)();
      }
    };
    return run(c);
  }, code);
  printResult(r);
  await b.disconnect();
}

async function cmdViewport(w, h) {
  const width = Number(w);
  const height = Number(h);
  if (!Number.isFinite(width) || !Number.isFinite(height)) usage();
  const b = await ensureBrowser();
  const p = await activePage(b);
  await p.setViewport({ width, height });
  console.log(`viewport ${width}x${height}`);
  await b.disconnect();
}

async function cmdScreenshot(pathFlag) {
  const b = await ensureBrowser();
  const p = await activePage(b);
  const file = pathFlag || join(tmpdir(), `shot-${Date.now()}.png`);
  await p.screenshot({ path: file });
  console.log(file);
  await b.disconnect();
}

async function cmdCookies() {
  const b = await ensureBrowser();
  const p = await activePage(b);
  for (const c of await p.cookies()) {
    console.log(`${c.name}: ${c.value}`);
    console.log(`  domain: ${c.domain} path: ${c.path} httpOnly: ${c.httpOnly} secure: ${c.secure}`);
  }
  await b.disconnect();
}

async function cmdContent(url) {
  if (!url) usage();
  const b = await ensureBrowser();
  const p = await activePage(b);
  await p.goto(url, { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 500)); // let JS settle
  const html = await p.content();
  await b.disconnect();

  const toMd = (h) => {
    const t = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    t.use(gfm);
    return t.turndown(h).replace(/\n{3,}/g, "\n\n").trim();
  };
  const doc = new JSDOM(html, { url: p.url() });
  const article = new Readability(doc.window.document).parse();
  console.log(`URL:   ${p.url()}`);
  if (article?.title) console.log(`Title: ${article.title}`);
  console.log("");
  console.log(toMd(article?.content || ""));
}

async function cmdPick(msg) {
  if (!msg) usage();
  const b = await ensureBrowser();
  const p = await activePage(b);
  await p.evaluate(() => {
    window.__pick = (message) => new Promise((resolve) => {
      const sel = []; const marked = new Set();
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
      const hi = document.createElement("div");
      hi.style.cssText = "position:absolute;border:2px solid #3b82f6;background:rgba(59,130,246,.1)";
      overlay.appendChild(hi);
      const banner = document.createElement("div");
      banner.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1f2937;color:#fff;padding:12px 24px;border-radius:8px;font:14px sans-serif;pointer-events:auto";
      const info = (el) => {
        const chain = [];
        let n = el.parentElement;
        while (n && n !== document.body) {
          const s = n.tagName.toLowerCase() + (n.id ? `#${n.id}` : "") + (n.className?.trim() ? `.${n.className.trim().split(/\s+/).join(".")}` : "");
          chain.unshift(s); n = n.parentElement;
        }
        return { tag: el.tagName.toLowerCase(), id: el.id || null, class: el.className || null, text: el.textContent?.trim().slice(0, 200) || null, parents: chain.join(" > ") };
      };
      const draw = () => { banner.textContent = `${message} (${sel.length} selected · Ctrl/Cmd+click to add · Enter finish · Esc cancel)`; };
      const cleanup = () => { document.removeEventListener("mousemove", mv, true); document.removeEventListener("click", cl, true); document.removeEventListener("keydown", kd, true); overlay.remove(); banner.remove(); marked.forEach((el) => (el.style.outline = "")); };
      const mv = (e) => {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || overlay.contains(el) || banner.contains(el)) return;
        const r = el.getBoundingClientRect();
        hi.style.cssText = `position:absolute;border:2px solid #3b82f6;background:rgba(59,130,246,.1);top:${r.top}px;left:${r.left}px;width:${r.width}px;height:${r.height}px`;
      };
      const cl = (e) => {
        if (banner.contains(e.target)) return;
        e.preventDefault(); e.stopPropagation();
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || overlay.contains(el) || banner.contains(el)) return;
        if (e.metaKey || e.ctrlKey) {
          if (!marked.has(el)) { marked.add(el); el.style.outline = "3px solid #10b981"; sel.push(info(el)); draw(); }
        } else { cleanup(); resolve(sel.length ? sel : info(el)); }
      };
      const kd = (e) => {
        if (e.key === "Escape") { e.preventDefault(); cleanup(); resolve(null); }
        else if (e.key === "Enter" && sel.length) { e.preventDefault(); cleanup(); resolve(sel); }
      };
      draw();
      document.body.append(banner, overlay);
      document.addEventListener("mousemove", mv, true);
      document.addEventListener("click", cl, true);
      document.addEventListener("keydown", kd, true);
    });
  });
  const r = await p.evaluate((m) => window.__pick(m), msg);
  printResult(r);
  await b.disconnect();
}

const [cmd, ...rest] = process.argv.slice(2);
const headless = rest.includes("--headless");
const opts0 = { new: rest.includes("--new"), reload: rest.includes("--reload") };
const pathIdx = rest.indexOf("--path");
const pathArg = pathIdx >= 0 ? rest[pathIdx + 1] : undefined;
const positional = rest.filter((a) => !a.startsWith("--"));

(async () => {
  switch (cmd) {
    case "start": await startBrowser(headless); break;
    case "stop": stopBrowser(); break;
    case "status": await cmdStatus(); break;
    case "nav": await cmdNav(positional[0], opts0); break;
    case "eval": await cmdEval(rest.join(" ")); break;
    case "screenshot": await cmdScreenshot(pathArg); break;
    case "viewport": await cmdViewport(positional[0], positional[1]); break;
    case "cookies": await cmdCookies(); break;
    case "content": await cmdContent(positional[0]); break;
    case "pick": await cmdPick(rest.join(" ")); break;
    default: usage();
  }
})().catch((e) => die(`✗ ${e.message}`));