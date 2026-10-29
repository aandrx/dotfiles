import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const AGENT_DIR = resolve(process.env.PI_CODING_AGENT_DIR || join(process.env.HOME || ".", ".pi", "agent"));
const ROLE_NAMES = ["researcher", "Plan", "implementer", "reviewer"] as const;
const REQUIRED_THINKING: Record<(typeof ROLE_NAMES)[number], string> = {
	researcher: "off",
	Plan: "medium",
	implementer: "low",
	reviewer: "high",
};
const ROLE_HINTS = [
	"For independent investigation, delegate bounded research to researcher and request evidence with source paths or URLs.",
	"For implementation planning, use Plan; it is read-only and must not implement.",
	"For code changes, use implementer for a single scoped write task, then use reviewer independently to inspect the result.",
	"For repeatable fanout, use research with args.tasks (or args.task); for staged coding, use implement-review with args.task and optional args.test or ready=true.",
	"For any delegation request, decide the form yourself and proceed without asking: a few named tasks use the Agent tool with roster roles; runtime-discovered fanout or many independently verified findings use the saved research workflow; a staged plan/implement/review change uses the saved implement-review workflow.",
	"Use the pi-subagents Agent and SubagentWorkflow tools for all delegation; do not use alternate subagent/workflow tools that bypass this roster.",
	"Do not dispatch built-in agent types or guess a replacement type. Unknown agent names must fail rather than fall back.",
].join(" ");

type Role = {
	name: string;
	path?: string;
	model?: string;
	thinking?: string;
	tools?: string;
	disallowedTools?: string;
	isolated?: string;
	extensions?: string;
	skills?: string;
	promptMode?: string;
	persistSession?: string;
	enabled?: boolean;
};

type ModelRef = { provider: string; id: string };

function agentDirectories(cwd: string): string[] {
	return [
		join(AGENT_DIR, "agents"),
		join(cwd, ".agents", "agents"),
		join(cwd, ".pi", "agents"),
	];
}

function findRoleFile(name: string, cwd: string): string | undefined {
	const candidates = new Map<string, string>();
	for (const dir of agentDirectories(cwd)) {
		if (!existsSync(dir)) continue;
		let files: string[];
		try {
			files = readdirSync(dir).filter((file) => file.endsWith(".md"));
		} catch {
			continue;
		}
		for (const file of files) {
			const path = join(dir, file);
			let content: string;
			try {
				content = readFileSync(path, "utf8");
			} catch {
				continue;
			}
			const declaredName = readField(content, "name") ?? basename(file, ".md");
			candidates.set(declaredName, path);
		}
	}
	if (candidates.has(name)) return candidates.get(name);
	const folded = [...candidates.entries()].filter(([candidate]) => candidate.toLowerCase() === name.toLowerCase());
	return folded.length === 1 ? folded[0][1] : undefined;
}

function readField(content: string, field: string): string | undefined {
	const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
	if (!frontmatter) return undefined;
	const value = frontmatter.match(new RegExp(`^${field}:\\s*(.*?)\\s*$`, "m"))?.[1];
	if (!value) return undefined;
	return value.replace(/^(["'])(.*)\1$/, "$2").trim() || undefined;
}

function readRole(name: string, cwd: string): Role {
	const path = findRoleFile(name, cwd);
	if (!path) return { name };
	try {
		const content = readFileSync(path, "utf8");
		return {
			name,
			path,
			model: readField(content, "model"),
			thinking: readField(content, "thinking"),
			tools: readField(content, "tools"),
			disallowedTools: readField(content, "disallowed_tools"),
			isolated: readField(content, "isolated"),
			extensions: readField(content, "extensions"),
			skills: readField(content, "skills"),
			promptMode: readField(content, "prompt_mode"),
			persistSession: readField(content, "persist_session"),
			enabled: readField(content, "enabled") !== "false",
		};
	} catch {
		return { name, path };
	}
}

function findWorkflow(name: string, cwd: string): { path: string; source: string } | undefined {
	const roots = [join(cwd, ".pi", "workflows"), join(cwd, ".agents", "workflows"), join(AGENT_DIR, "workflows")];
	for (const root of roots) {
		const path = join(root, `${name}.js`);
		if (!existsSync(path)) continue;
		try {
			return { path, source: readFileSync(path, "utf8") };
		} catch {
			return undefined;
		}
	}
	return undefined;
}

function checkWorkflowInput(input: Record<string, unknown>, cwd: string): string | undefined {
	const name = typeof input.name === "string" ? input.name : "";
	if (!name || !["research", "implement-review"].includes(name)) {
		return "Only the saved Pi Crew workflows `research` and `implement-review` are enabled. Use `name`; inline scripts and arbitrary script paths are blocked.";
	}
	if (input.script !== undefined || input.scriptPath !== undefined) {
		return "Pi Crew workflows must be run by saved name so their delegation policy can be checked.";
	}
	const workflow = findWorkflow(name, cwd);
	if (!workflow) return `Saved Pi Crew workflow ${name} is missing.`;
	const canonicalPath = join(AGENT_DIR, "workflows", `${name}.js`);
	if (workflow.path !== canonicalPath) {
		return `Project workflow ${workflow.path} shadows Pi Crew's pinned ${name} workflow. Remove or rename the project override.`;
	}
	const calls = workflow.source.match(/\bagent\s*\(/g)?.length ?? 0;
	const types = [...workflow.source.matchAll(/agentType\s*:\s*(["'])(.*?)\1/g)].map((match) => match[2]);
	if (calls === 0 || calls !== types.length) {
		return `Workflow ${name} must declare a static agentType for every agent() call.`;
	}
	const unknown = types.filter((type) => !ROLE_NAMES.some((role) => role.toLowerCase() === type.toLowerCase()));
	if (unknown.length) return `Workflow ${name} requests unapproved agent type(s): ${[...new Set(unknown)].join(", ")}.`;
	return undefined;
}

function availableModels(ctx: ExtensionContext): ModelRef[] {
	return ctx.modelRegistry.getAvailable().map(({ provider, id }) => ({ provider, id }));
}

function checkProjectDispatchPolicy(cwd: string): string[] {
	const path = join(cwd, ".pi", "subagents.json");
	if (!existsSync(path)) return [];
	try {
		const config = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		const issues: string[] = [];
		if (config.disableDefaultAgents === false) issues.push("project subagents.json re-enables built-in agents");
		const fallback = config.fallbackSubagent;
		if (typeof fallback === "string" && fallback.trim() && fallback.trim().toLowerCase() !== "none") {
			issues.push(`project subagents.json overrides fallbackSubagent with ${fallback.trim()}`);
		}
		return issues;
	} catch {
		return [`project settings are malformed: ${path}`];
	}
}

function checkRoster(ctx: ExtensionContext): { roles: Role[]; issues: string[] } {
	const models = availableModels(ctx);
	const roles = ROLE_NAMES.map((name) => readRole(name, ctx.cwd));
	const issues: string[] = checkProjectDispatchPolicy(ctx.cwd);
	for (const role of roles) {
		if (!role.path || role.enabled === false) {
			issues.push(`${role.name}: definition missing or disabled`);
			continue;
		}
		if (!role.model) {
			issues.push(`${role.name}: model pin missing`);
		} else {
			const slash = role.model.indexOf("/");
			if (slash < 1 || !models.some((model) => model.provider === role.model!.slice(0, slash) && model.id === role.model!.slice(slash + 1))) {
				issues.push(`${role.name}: exact model ${role.model} is unavailable; dispatch would risk resolving another model or inheriting the parent`);
			}
		}
		const expectedThinking = REQUIRED_THINKING[role.name as keyof typeof REQUIRED_THINKING];
		if (role.thinking !== expectedThinking) {
			issues.push(`${role.name}: thinking must be ${expectedThinking}, found ${role.thinking ?? "unset"}`);
		}
		const expectedTools = role.name === "researcher"
			? ["read", "grep", "find", "ls", "ext:pi-ollama-cloud/ollama_web_search", "ext:pi-ollama-cloud/ollama_web_fetch", "ext:tavily-search/tavily_web_search", "ext:tavily-search/tavily_web_extract", "ext:searxng-search/searxng_web_search", "ext:ruepi-web-extract/ruepi_web_extract", "ext:exa-search/exa_web_search", "ext:exa-search/exa_web_fetch"]
			: role.name === "implementer"
				? ["read", "bash", "grep", "find", "ls", "edit", "write"]
				: ["read", "bash", "grep", "find", "ls"];
		const actualTools = role.tools?.split(",").map((tool) => tool.trim()).filter(Boolean).sort() ?? [];
		if (actualTools.join(",") !== [...expectedTools].sort().join(",")) {
			issues.push(`${role.name}: tools must be ${expectedTools.join(",")}`);
		}
		if (role.name === "researcher") {
			if (role.isolated === "true" || role.extensions !== "pi-ollama-cloud,tavily-search,searxng-search,ruepi-web-extract,exa-search,dsh-compaction" || role.skills !== "false" || (role.tools ?? "").split(",").map((tool) => tool.trim()).includes("ext:dsh-compaction/dsh_compact")) {
				issues.push("researcher: must load only the approved web extensions plus dsh-compaction, with no DSH tool or skills");
			}
		} else if (role.isolated !== "false" || role.extensions !== "dsh-compaction" || role.skills !== "false" || !(role.disallowedTools ?? "").split(",").map((tool) => tool.trim()).includes("dsh_compact")) {
			issues.push(`${role.name}: must load only dsh-compaction, deny dsh_compact, disable skills, and set isolation false`);
		}
		if (role.promptMode !== "append") issues.push(`${role.name}: prompt_mode must be append`);
		// No role persists its session. A persisted child exists only so `@handle`
		// can reopen a conversation after its record is evicted, which this roster
		// does not use; all it did was write a session file per agent and clutter
		// /resume. Enforced here so `persist_session: true` cannot creep back.
		if (role.persistSession === "true") {
			issues.push(`${role.name}: persist_session must not be true (no subagent session is persisted)`);
		}
	}
	return { roles, issues };
}

function formatStatus(ctx: ExtensionContext): string {
	const { roles, issues } = checkRoster(ctx);
	const rows = roles.map((role) => {
		const suffix = role.path ? "" : " (missing)";
		return `- ${role.name}: ${role.model ?? "no model"} | thinking ${role.thinking ?? "unset"}${suffix}`;
	});
	const workflows = ["research", "implement-review"].map((name) => {
		const problem = checkWorkflowInput({ name }, ctx.cwd);
		return `- ${name}: ${problem ? `NOT READY (${problem})` : "ready"}`;
	});
	const workflowIssues = workflows.some((line) => line.includes("NOT READY"));
	return ["Pi Crew roster", ...rows, issues.length ? `ROSTER CHECK FAILED\n${issues.map((issue) => `- ${issue}`).join("\n")}` : "ROSTER CHECK PASSED: role pins/config resolve exactly.", "Workflows", ...workflows, !workflowIssues ? "WORKFLOW CHECK PASSED." : "WORKFLOW CHECK FAILED."].join("\n");
}


export default function (pi: ExtensionAPI) {
	pi.on("session_start", () => {
		const alternateTools = new Set(["subagent", "workflow", "ralph"]);
		pi.setActiveTools(pi.getActiveTools().filter((name) => !alternateTools.has(name)));
	});

	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.promptGuidelines.push(ROLE_HINTS);
	});

	pi.on("tool_call", (event, ctx) => {
		if (["subagent", "workflow", "ralph"].includes(event.toolName)) {
			return { block: true, reason: "Alternate DSH delegation bypasses the Pi Crew role and model pins. Use the pi-subagents Agent tool with a named role, or a saved Pi Crew workflow." };
		}
		if (event.toolName !== "Agent" && event.toolName !== "SubagentWorkflow") return;
		const { issues } = checkRoster(ctx);
		if (issues.length) {
			return {
				block: true,
				reason: `Pi Crew preflight failed. Run /crew to inspect and fix the roster before dispatch.\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
			};
		}

		const input = event.input as Record<string, unknown>;
		if (event.toolName === "SubagentWorkflow") {
			const workflowIssue = checkWorkflowInput(input, ctx.cwd);
			if (workflowIssue) return { block: true, reason: workflowIssue };
		}

		if (event.toolName === "Agent") {
			const requested = typeof input.subagent_type === "string" ? input.subagent_type : "";
			const role = ROLE_NAMES.find((name) => name.toLowerCase() === requested.toLowerCase());
			if (!role) {
				return { block: true, reason: `Unknown Pi Crew role "${requested}". Choose one of: ${ROLE_NAMES.join(", ")}.` };
			}
			const config = readRole(role, ctx.cwd);
			if (typeof input.model === "string" && input.model !== config.model) {
				return { block: true, reason: `The ${role} role is pinned to ${config.model}. Hot-swap by editing its agent file; per-call model overrides are intentionally rejected.` };
			}
			if (typeof input.thinking === "string" && input.thinking !== config.thinking) {
				return { block: true, reason: `The ${role} role uses thinking=${config.thinking}. Change its agent file to hot-swap the role setting.` };
			}
		}
	});

	pi.registerCommand("crew", {
		description: "Inspect Pi Crew and safely swap role models",
		handler: async (args, ctx) => {
			const [action = "status", roleName, modelId, ...extra] = args.trim().split(/\s+/).filter(Boolean);
			if (action === "status" || action === "check") {
				const { issues } = checkRoster(ctx);
				const report = formatStatus(ctx);
				ctx.ui.notify(report, issues.length || report.includes("WORKFLOW CHECK FAILED") ? "warning" : "info");
				return;
			}
			if (action !== "model" || !roleName || !modelId || extra.length) {
				ctx.ui.notify("Usage: /crew [status|check] | /crew model <role> <exact-provider/model-id>", "warning");
				return;
			}
			const role = ROLE_NAMES.find((name) => name.toLowerCase() === roleName.toLowerCase());
			if (!role) {
				ctx.ui.notify(`Unknown role ${roleName}. Choose: ${ROLE_NAMES.join(", ")}.`, "error");
				return;
			}
			const slash = modelId.indexOf("/");
			const exactMatch = slash > 0 && ctx.modelRegistry.getAvailable().some((model) => model.provider === modelId.slice(0, slash) && model.id === modelId.slice(slash + 1));
			if (!exactMatch) {
				ctx.ui.notify(`Model is not available as an exact provider/model match: ${modelId}`, "error");
				return;
			}
			const definition = readRole(role, ctx.cwd);
			if (!definition.path || definition.enabled === false) {
				ctx.ui.notify(`Cannot swap ${role}: active agent definition is missing or disabled.`, "error");
				return;
			}
			const content = readFileSync(definition.path, "utf8");
			if (!/^---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(content)) {
				ctx.ui.notify(`Cannot update ${role}: malformed agent frontmatter in ${definition.path}`, "error");
				return;
			}
			let updated: string;
			if (/^model:\s*.*$/m.test(content)) {
				updated = content.replace(/^model:\s*.*$/m, `model: ${modelId}`);
			} else {
				updated = content.replace(/^(---\s*\r?\n)/, `$1model: ${modelId}\n`);
			}
			const tempPath = `${definition.path}.tmp`;
			try {
				writeFileSync(tempPath, updated, "utf8");
				renameSync(tempPath, definition.path);
				ctx.ui.notify(`${role} now uses ${modelId}. New dispatches will use the updated pin.`, "info");
			} catch (error) {
				ctx.ui.notify(`Could not update ${definition.path}: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}
