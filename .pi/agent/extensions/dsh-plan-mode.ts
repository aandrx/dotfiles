/**
 * dsh-plan-mode — read-only planning mode.
 *
 * While plan mode is active for a session, `edit` and `write` tool calls are
 * blocked at the `tool_call` gate until the user runs /approve. Reads,
 * searches, and bash pass through so the model can investigate freely.
 *
 * State is in-memory per process, keyed by session id. Subprocess children
 * (pi --mode json) load this same extensions dir but run in a separate
 * process with separate memory, so they start with plan mode OFF
 * automatically and are never blocked by the parent's state.
 *
 * Model visibility choice: RegisteredCommand only carries name/description/
 * handler (no promptSnippet slot; only ToolDefinition has promptSnippet and
 * promptGuidelines). So the model-facing rules live in the `plan_status`
 * tool below: its description plus promptSnippet state the mode rules, and
 * the /plan command description mirrors them briefly. The block reason
 * message also restates the rule at the moment it matters.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** Active plan goal per session id. Absence of a key means plan mode is OFF. */
const goals = new Map<string, string>();
const ENTRY_TYPE = "dsh-plan-mode";
const VERSION = 1;
function persist(pi: ExtensionAPI, active: boolean, goal: string | null, boundary = false): void {
  const data = { version: VERSION, active, goal };
  if (boundary && "createBranchDraft" in pi) (pi as any).createBranchDraft(ENTRY_TYPE, data);
  else pi.appendEntry(ENTRY_TYPE, data);
}
function restore(ctx: ExtensionContext, id: string): void {
  goals.delete(id);
  const entries = ctx.sessionManager.getBranch();
  for (const entry of entries as any[]) {
    if ((entry?.type !== ENTRY_TYPE && entry?.customType !== ENTRY_TYPE) || entry?.data?.version !== VERSION) continue;
    const data = entry.data;
    if (data.active === true && typeof data.goal === "string") goals.set(id, data.goal);
    else if (data.active === false) goals.delete(id);
  }
}

function sessionId(ctx: ExtensionContext | ExtensionCommandContext): string {
  try {
    return ctx.sessionManager.getSessionId();
  } catch {
    return "default";
  }
}

function blockMessage(goal: string): string {
  return `plan-mode active: edits blocked until /approve. Goal: ${goal}`;
}

function statusText(ctx: ExtensionContext | ExtensionCommandContext): string {
  const goal = goals.get(sessionId(ctx));
  return goal === undefined
    ? "plan-mode: OFF (edits allowed)"
    : `plan-mode: ON\nGoal: ${goal}\nEdits (edit/write) are blocked until /approve or /plan-off.`;
}

export default function dshPlanMode(pi: ExtensionAPI): void {
  // Drop state for sessions other than the current one, so a process reused
  // across sessions (reload / switch) never leaks a stale plan goal.
  const loadBranch = (_event: unknown, ctx: ExtensionContext) => {
    const current = sessionId(ctx);
    for (const key of goals.keys()) if (key !== current) goals.delete(key);
    restore(ctx, current);
  };
  pi.on("session_start", loadBranch);
  pi.on("session_switch", loadBranch);
  const draftState = (event: any, ctx: ExtensionContext) => {
    const goal = goals.get(sessionId(ctx));
    const entry = { type: "custom", customType: ENTRY_TYPE, data: { version: VERSION, active: goal !== undefined, goal: goal ?? null } };
    return { entries: [...(event.entries ?? []), entry] };
  };
  pi.on("agent_before_settle", draftState);
  pi.on("turn_end", draftState);

  pi.registerCommand("plan", {
    description:
      "Enter read-only plan mode with a goal (/plan <goal>). While active, edit/write tools are blocked; reads, searches, and bash pass through. Exit with /approve or /plan-off.",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const goal = args.trim();
      if (!goal) {
        ctx.ui.notify("Usage: /plan <goal>", "warning");
        return;
      }
      goals.set(sessionId(ctx), goal);
      persist(pi, true, goal);
      ctx.ui.notify(
        `plan-mode ON. Goal: ${goal}\nWrite a plan; do not edit files. Reads, searches, and bash are allowed. /approve to allow edits, /plan-off to exit.`,
        "info",
      );
    },
  });

  pi.registerCommand("approve", {
    description:
      "Approve the plan and exit plan mode, allowing edit/write tools again.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const id = sessionId(ctx);
      if (!goals.has(id)) {
        ctx.ui.notify("plan-mode is already OFF.", "info");
        return;
      }
      const goal = goals.get(id);
      goals.delete(id);
      persist(pi, false, null);
      ctx.ui.notify(`plan-mode OFF. Plan approved: ${goal}`, "info");
    },
  });

  pi.registerCommand("plan-off", {
    description: "Exit plan mode without approving the plan.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const id = sessionId(ctx);
      if (!goals.has(id)) {
        ctx.ui.notify("plan-mode is already OFF.", "info");
        return;
      }
      goals.delete(id);
      persist(pi, false, null);
      ctx.ui.notify("plan-mode OFF (plan not approved).", "info");
    },
  });

  pi.registerCommand("plan-status", {
    description: "Show whether plan mode is active and the current goal.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      ctx.ui.notify(statusText(ctx), "info");
    },
  });

  // Intentional divergence from upstream's guidance-only model: enforce the
  // read-only rule at tool_call by blocking edit/write while plan mode is active.
  pi.on("tool_call", (event, ctx) => {
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    const goal = goals.get(sessionId(ctx));
    if (goal === undefined) return;
    return { block: true, reason: blockMessage(goal) };
  });

  // Model-facing rule carrier (see header comment for why a tool, not a command).
  // Do not query getAllTools() here: it is a runtime action method and Pi
  // rejects action-method calls while extensions are being initialized.
  // Pi's tool registry owns duplicate-name validation during registration.
  // Tool-name uniqueness is owned by pi's registry, not assertable in the harness.
  pi.registerTool({
    name: "plan_status",
    label: "Plan Status",
    description:
      "Report whether read-only plan mode is active. Rules: when plan mode is ON, you must only investigate (read, grep, find, ls, bash) and write a plan; NEVER call edit or write (they are blocked) until the user runs /approve. /plan <goal> enters plan mode, /plan-status shows state, /plan-off exits without approval.",
    promptSnippet: "plan_status: check plan mode; when ON, plan only, never edit or write until /approve.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      return {
        content: [{ type: "text", text: statusText(ctx) }],
        details: {},
      };
    },
  });
}
