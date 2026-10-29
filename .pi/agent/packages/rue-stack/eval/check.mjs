import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { apply, createState, snapshot } from "../extensions/task-state-core.mjs";
import { GLOBAL_POLICY, SECTION_KEY as POLICY_KEY, injectPolicy } from "../extensions/global-policy.mjs";
import { MODES, SECTION_KEY as MODE_KEY, contractFor, injectMode, resolveMode } from "../extensions/mode-core.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (rel) => readFile(join(root, rel), "utf8");

async function filesUnder(path) {
  const files = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const child = join(current, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  await walk(path);
  return files;
}

const pkg = JSON.parse(await read("package.json"));
assert(pkg.keywords.includes("pi-package"));
assert.equal(pkg.scripts.test, "node eval/check.mjs");
assert.equal(pkg.scripts.e2e, "node eval/e2e/run.mjs");
assert.deepEqual(pkg.pi.extensions.sort(), [
  "./extensions/global-policy.ts",
  "./extensions/mode.ts",
  "./extensions/task-state.ts",
]);
assert.deepEqual(pkg.pi.skills, ["./skills"]);
assert.deepEqual(pkg.pi.prompts, []);
for (const resource of [...pkg.pi.extensions, ...pkg.pi.skills]) await access(join(root, resource));

// Task state
let state = apply(createState(), { action: "initialize", items: ["first verbatim ", "second"] });
assert.deepEqual(state.items.map((item) => [item.id, item.text, item.status]), [[1, "first verbatim ", "pending"], [2, "second", "pending"]]);
state = apply(state, { action: "set_status", id: 1, status: "active" });
state = apply(state, { action: "set_status", id: 1, status: "done" });
state = apply(state, { action: "skip", id: 2, reason: "out of scope" });
assert.deepEqual(state.items.map((item) => item.status), ["done", "skipped"]);
assert.equal(state.items[1].reason, "out of scope");
const listed = apply(state, { action: "list" });
listed.items[0].status = "pending";
assert.equal(state.items[0].status, "done", "list must return an immutable snapshot");
const frozen = snapshot(state);
state.items[0].status = "pending";
assert.equal(frozen.items[0].status, "done", "snapshot must not alias state");
assert.deepEqual(apply(state, { action: "initialize", items: ["new task"] }), { items: [{ id: 1, text: "new task", status: "pending" }], nextId: 2 });
assert.deepEqual(apply(createState(), { action: "initialize", items: '["alpha", "beta"]' }).items.map((i) => i.text), ["alpha", "beta"]);
assert.deepEqual(apply(createState(), { action: "initialize", items: "alpha\nbeta\n" }).items.map((i) => i.text), ["alpha", "beta"]);
for (const invalid of [
  { action: "skip", id: 1, reason: "  " },
  { action: "set_status", id: 1, status: "skipped" },
  { action: "set_status", id: 42, status: "done" },
  { action: "initialize", items: [] },
  { action: "initialize", items: ["valid", " "] },
  { action: "unknown", id: 1 },
]) assert.throws(() => apply(frozen, invalid));

// Global policy injection
const sections = { existing: "keep me" };
const event = { systemPromptOptions: { sections } };
injectPolicy(event);
assert.equal(sections.existing, "keep me");
assert.equal(sections[POLICY_KEY], GLOBAL_POLICY);
assert(GLOBAL_POLICY.includes("Use rue-mode for multi-step local codebase investigation"));
assert(GLOBAL_POLICY.includes("GitHub SSH is already configured"));
sections[POLICY_KEY] = "stale";
injectPolicy(event);
assert.equal(sections[POLICY_KEY], GLOBAL_POLICY, "repeat injection must replace the stable section");
assert.throws(() => injectPolicy({ systemPromptOptions: { sections: [] } }));

// Modes
assert.deepEqual(MODES, ["shipp", "momentum", "quality"]);
assert.equal(resolveMode("SHIPP"), "shipp");
assert.equal(resolveMode(" off "), "off");
assert.equal(resolveMode("bogus"), null);
const shared = "Never claim success you did not verify";
const shipp = contractFor("shipp");
const momentum = contractFor("momentum");
assert(shipp.includes(shared) && momentum.includes(shared), "both modes must carry the shared invariants");
assert(shipp.includes("regression test") && shipp.includes("rue_task_state"));
const quality = contractFor("quality");
assert(quality.includes(shared), "quality must carry the shared invariants");
assert(/E2E matrix/.test(quality) && /at most 25 tool calls/i.test(quality));
assert(/switch to \/shipp/i.test(quality), "quality must hand fixes to shipp");
const qualityFix = contractFor("quality", { fix: true });
assert(!/Repair authorized/.test(quality), "plain quality must stay read-only");
assert(/Repair authorized/.test(qualityFix), "quality fix must authorize repair");
assert(/re-run the matrix rows/i.test(qualityFix), "quality fix must require matrix re-runs");
assert.equal(contractFor("shipp", { fix: true }), contractFor("shipp"), "fix flag must not affect other modes");
assert(/quality audit/i.test(shipp), "shipp must accept an audit handoff");
assert(contractFor("off") === "");
assert(momentum.includes(".plans/") && momentum.includes("better-ui") && momentum.includes("codex"));
assert(/at most 15 tool calls/i.test(shipp), "shipp must carry the tool-call budget");
assert(/continue/i.test(shipp), "shipp budget must allow an explicit continuation");
assert(shipp.includes("technical-writing") && momentum.includes("ste"));
for (const text of [shipp, momentum]) {
  assert(/active mode/i.test(text), "both contracts must require naming the active mode");
}

assert.equal(contractFor("off"), "");
assert.notEqual(shipp, momentum);
const modeSections = { existing: "keep me" };
const modeEvent = { systemPromptOptions: { sections: modeSections } };
injectMode(modeEvent, "shipp");
assert.equal(modeSections[MODE_KEY], shipp);
injectMode(modeEvent, "momentum");
assert.equal(modeSections[MODE_KEY], momentum, "mode switch must replace, not append");
injectMode(modeEvent, "off");
assert.equal(modeSections[MODE_KEY], undefined, "off must clear the mode section");
assert.equal(modeSections.existing, "keep me");
injectPolicy(modeEvent);
assert(modeSections[POLICY_KEY] && modeSections[MODE_KEY] === undefined, "policy and mode sections are independent");

// Vendored files: hashes must match the manifest, so drift is detectable
const vendor = JSON.parse(await read("VENDOR.json"));
assert(vendor.upstream.pstack && vendor.upstream.jmo);
assert(vendor.files.length > 40);
const EXPECTED_PATCHED = new Set([
  "skills/how/SKILL.md",
  "skills/dimensional-drawing/SKILL.md",
  "skills/no-comments/SKILL.md",
  "skills/show-me-your-work/SKILL.md",
  "skills/recall/SKILL.md",
  "skills/interview/SKILL.md",
  "skills/agentation/SKILL.md",
  "skills/codex/SKILL.md",
  "skills/motion-design/SKILL.md",
]);
for (const entry of vendor.files) {
  const path = join(root, entry.installed_path);
  const data = await readFile(path);
  const hash = createHash("sha256").update(data).digest("hex");
  assert.equal(hash, entry.sha256_current, `${entry.installed_path} drifted since it was recorded`);
  assert(entry.upstream_path && entry.source && entry.sha256_transformed);
  if (entry.patched) assert(EXPECTED_PATCHED.has(entry.installed_path), `undeclared upstream patch: ${entry.installed_path}`);
}
assert.equal(vendor.files.filter((e) => e.patched).length, EXPECTED_PATCHED.size, "patched-file set changed");
for (const license of ["LICENSES/pstack-LICENSE", "LICENSES/jmo-LICENSE"]) await access(join(root, license));
await access(join(root, "skills/agentation/LICENSE"));

// Skills: names, descriptions, substance, uniqueness
const skillDirs = (await readdir(join(root, "skills"), { withFileTypes: true })).filter((e) => e.isDirectory());
const vendoredSkills = new Set(vendor.files.map((f) => f.installed_path.split("/")[1]).filter(Boolean));
const names = new Set();
for (const dir of skillDirs) {
  const rel = `skills/${dir.name}/SKILL.md`;
  const source = await read(rel);
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---/)?.[1];
  assert(frontmatter, `${rel}: missing frontmatter`);
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  assert.equal(name, dir.name, `${rel}: name must match directory`);
  const minDescription = vendoredSkills.has(dir.name) ? 30 : 60;
  assert(description && description.length >= minDescription, `${rel}: routing description is too weak`);
  if (description && /: /.test(description)) {
    assert(/^["']/.test(description), `${rel}: description with a colon must be quoted YAML`);
  }
  assert(source.split("\n").length >= 4, `${rel}: procedure is empty`);
  assert(!names.has(name), `duplicate skill ${name}`);
  names.add(name);
  if (!vendoredSkills.has(dir.name)) {
    assert(source.split("\n").length >= 10, `${rel}: owned skill procedure is too shallow`);
    assert(/stop|unavailable|unless|do not|never/i.test(source), `${rel}: missing boundary or stop condition`);
  }
}
for (const required of ["rue-mode", "interview", "ste", "better-ui", "animate", "agentation", "codex", "how", "blast-radius", "tdd", "technical-writing", "unslop", "teach", "quality", "motion-design"]) {
  assert(names.has(required), `missing skill ${required}`);
}
assert.equal(names.size, skillDirs.length);

// Context budget: only skills without disable-model-invocation reach the prompt.
// Keep the always-on catalog small so the stack stays lighter than the setup it replaces.
const EXPLICIT_ONLY = [
  "agentation", "benchmark-checklist", "blast-radius", "codex", "correct",
  "create-verification-skill", "how", "maintain-verification-skill", "no-comments",
  "recall", "sharpen", "show-me-your-work", "tdd", "teach", "technical-writing",
  "typescript-best-practices", "unslop", "interview", "quality",
];
let visibleCatalog = 0;
for (const dir of skillDirs) {
  const rel = `skills/${dir.name}/SKILL.md`;
  const source = await read(rel);
  const frontmatter = source.split("---")[1] ?? "";
  const visible = !frontmatter.includes("disable-model-invocation: true");
  if (EXPLICIT_ONLY.includes(dir.name)) {
    assert(!visible, `${rel}: expected explicit-only, but it is visible in the prompt`);
  } else {
    assert(visible, `${rel}: expected auto-loadable, but it is hidden`);
    const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1] ?? "";
    visibleCatalog += dir.name.length + description.length + rel.length + 4;
  }
}
assert(visibleCatalog <= 3200, `visible skill catalog grew to ${visibleCatalog} bytes; trim or hide a skill`);

const router = await read("skills/rue-mode/SKILL.md");
for (const playbook of ["investigation", "bug-fix", "feature", "refactor"]) {
  assert(router.includes(`../../playbooks/${playbook}.md`));
  const source = await read(`playbooks/${playbook}.md`);
  for (let step = 1; step <= 6; step += 1) assert(source.includes(`${step}. `), `${playbook}: missing step ${step}`);
}
assert(router.includes("rue_task_state"));

const taskExtension = await read("extensions/task-state.ts");
for (const token of ["session_start", "session_tree", "getBranch", "details", "task-state-core.mjs"]) assert(taskExtension.includes(token));
const policyExtension = await read("extensions/global-policy.ts");
assert(policyExtension.includes('pi.on("before_agent_start"'));
assert(policyExtension.includes("injectPolicy(event)"));
const modeExtension = await read("extensions/mode.ts");
for (const token of ["registerCommand(\"mode\"", "registerCommand(\"shipp\"", "registerCommand(\"momentum\"", "appendEntry", "getBranch", "injectMode"]) {
  assert(modeExtension.includes(token), `mode.ts missing ${token}`);
}
assert(/pi\.on\("before_agent_start",\s*\(event,\s*ctx\)/.test(modeExtension), "before_agent_start must receive ctx");
assert(modeExtension.includes("sessionId(ctx)"), "mode lookup must use the session context, not the event");
assert(/startsWith\("fix"\)/.test(modeExtension) || modeExtension.includes('startsWith("fix")'), "quality command must parse a fix argument");
assert(modeExtension.includes("sendMessage"), "mode changes must be recorded in the transcript");
assert(/Mode changed: \$\{previous\} -> \$\{next\}/.test(modeExtension), "mode change message must name both modes");

// E2E fixtures and runner
for (const fixture of [
  "csv-project/csv_export.py",
  "csv-project/test_csv_export.py",
  "malicious-project/README.md",
  "malicious-project/package.json",
  "../fixture-skills/browser-tools/SKILL.md",
]) await access(join(root, "eval", "e2e", "fixtures", fixture));
const launcher = await read("bin/rue-shadow");
for (const extension of ["global-policy.ts", "task-state.ts", "mode.ts"]) {
  assert(launcher.includes(extension), `bin/rue-shadow does not load ${extension}`);
}
const syntax = spawnSync(process.execPath, ["--check", join(root, "eval", "e2e", "run.mjs")], { encoding: "utf8" });
assert.equal(syntax.status, 0, syntax.stderr);

// Recursive safety and branding scan
const textExtensions = new Set([".md", ".json", ".js", ".mjs", ".ts", ".sh", ".py", ".txt", ".yaml", ".yml"]);
const allFiles = (await filesUnder(root)).filter((p) => textExtensions.has(extname(p)));
const detectorAllowlist = new Set(["eval/check.mjs", "eval/e2e/run.mjs", "eval/MANUAL-TESTS.md", "eval/e2e/fixtures/malicious-project/README.md"]);
const brandAllowlist = /^(VENDOR\.json|LICENSES\/|README\.md|PLAN-V2\.md|INTEGRATION\.md|eval\/)/;
const liveHome = ["/home", "rue"].join("/");
const hardcodedLive = [`${liveHome}/.pi/agent`, `${liveHome}/dotfiles`, `${liveHome}/.ssh`];
const credentialRead = /(?:cat|head|tail|sed|less|cp)\s+[^\n;]*(?:(?:auth|models)\.json|\.ssh)/i;
const keyMutation = /ssh-keygen/i;
const brandTokens = /\b(poteto|jmo|sicko)\b|claude/i;
const brandCursor = /\bCursor\b/;
for (const path of allFiles) {
  const rel = relative(root, path);
  const source = await readFile(path, "utf8");
  for (const forbidden of hardcodedLive) assert(!source.includes(forbidden), `${rel}: hardcoded live path ${forbidden}`);
  if (!brandAllowlist.test(rel)) {
    assert(!brandTokens.test(source), `${rel}: residual upstream branding`);
    assert(!brandCursor.test(source), `${rel}: residual Cursor harness reference`);
  }
  if (!detectorAllowlist.has(rel)) {
    assert(!credentialRead.test(source), `${rel}: credential-reading command pattern`);
    assert(!keyMutation.test(source), `${rel}: SSH-key mutation command pattern`);
  }
}

console.log(`OK: task state, policy and mode injection, ${names.size} skills (${vendor.files.length} vendored files hash-verified), license and brand checks`);
