import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { MODES, injectMode, resolveMode } from "./mode-core.mjs";

const ENTRY_TYPE = "rue-stack-mode";
const VERSION = 1;
type Mode = "shipp" | "momentum" | "quality" | "off";

/** Active mode per session id. Absence means "off". */
const modes = new Map<string, Mode>();
/** Sessions where quality mode may repair findings. */
const repairs = new Set<string>();

function sessionId(ctx: ExtensionContext | ExtensionCommandContext): string {
  try {
    return ctx.sessionManager.getSessionId();
  } catch {
    return "default";
  }
}

function persist(pi: ExtensionAPI, mode: Mode, fix = false, boundary = false): void {
  const data = { version: VERSION, mode, fix };
  if (boundary && "createBranchDraft" in pi) (pi as any).createBranchDraft(ENTRY_TYPE, data);
  else pi.appendEntry(ENTRY_TYPE, data);
}

function restore(ctx: ExtensionContext, id: string): void {
  modes.delete(id);
  repairs.delete(id);
  for (const entry of ctx.sessionManager.getBranch() as any[]) {
    if ((entry?.type !== ENTRY_TYPE && entry?.customType !== ENTRY_TYPE) || entry?.data?.version !== VERSION) continue;
    const value = resolveMode(entry.data.mode);
    if (value === "off") { modes.delete(id); repairs.delete(id); }
    else if (value) {
      modes.set(id, value);
      if (entry.data.fix === true) repairs.add(id); else repairs.delete(id);
    }
  }
}

function statusLine(mode: Mode): string {
  if (mode === "off") return "mode: off (plain direct work, shared invariants only)";
  return `mode: ${mode}`;
}

export default function rueStackMode(pi: ExtensionAPI): void {
  const load = (_event: unknown, ctx: ExtensionContext) => {
    const current = sessionId(ctx);
    for (const key of modes.keys()) if (key !== current) modes.delete(key);
    restore(ctx, current);
    // Bootstrap from the environment when the branch has no explicit choice.
    // Used by scripted runs and tests; an interactive /mode always wins.
    if (!modes.has(current)) {
      const boot = resolveMode(process.env.RUE_STACK_MODE);
      if (boot && boot !== "off") {
        modes.set(current, boot);
        persist(pi, boot, false);
      }
    }
  };
  pi.on("session_start", load);
  pi.on("session_switch", load);
  pi.on("session_tree", load);

  const draft = (event: any, ctx: ExtensionContext) => {
    const mode = modes.get(sessionId(ctx)) ?? "off";
    const entry = { type: "custom", customType: ENTRY_TYPE, data: { version: VERSION, mode, fix: repairs.has(sessionId(ctx)) } };
    return { entries: [...(event.entries ?? []), entry] };
  };
  pi.on("turn_end", draft);

  pi.on("before_agent_start", (event, ctx) => {
    injectMode(event, modes.get(sessionId(ctx)) ?? "off", repairs.has(sessionId(ctx)));
  });

  const switchTo = (pi2: ExtensionAPI, ctx: ExtensionCommandContext, next: Mode, fix = false) => {
    const id = sessionId(ctx);
    const previous = modes.get(id) ?? "off";
    if (next === "off") { modes.delete(id); repairs.delete(id); }
    else {
      modes.set(id, next);
      if (next === "quality" && fix) repairs.add(id); else repairs.delete(id);
    }
    persist(pi2, next, next === "quality" && fix);
    // Record the transition in the transcript, not only in the prompt section.
    // Without a visible event, a model reconstructs the mode from earlier turns
    // and can attribute work to the wrong mode after a mid-session switch.
    try {
      pi2.sendMessage(
        {
          customType: "rue-stack-mode-change",
          content: `Mode changed: ${previous} -> ${next}. The active contract is now ${next}. Do not attribute work done under ${previous} to ${next}; state which mode each claim was verified under.`,
          display: true,
        },
        { triggerTurn: false },
      );
    } catch {
      // A transcript event is best-effort; the contract section still switches.
    }
    ctx.ui.notify(statusLine(next), "info");
  };

  pi.registerCommand("mode", {
    description: `Show or set the active mode: /mode <${MODES.join("|")}|off>. /shipp and /momentum are shortcuts.`,
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const raw = args.trim();
      if (!raw || raw === "status") {
        ctx.ui.notify(statusLine(modes.get(sessionId(ctx)) ?? "off"), "info");
        return;
      }
      const next = resolveMode(raw);
      if (!next) {
        ctx.ui.notify(`Unknown mode "${raw}". Use ${MODES.join(", ")}, or off.`, "warning");
        return;
      }
      switchTo(pi, ctx, next as Mode);
    },
  });

  pi.registerCommand("shipp", {
    description: "Switch to shipp mode: playbooks, reproduction, regression tests, same-surface verification.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => switchTo(pi, ctx, "shipp"),
  });

  pi.registerCommand("momentum", {
    description: "Switch to momentum mode: spec via interview, thinnest vertical slice, UI polish, Codex backend.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => switchTo(pi, ctx, "momentum"),
  });

  pi.registerCommand("quality", {
    description: "Switch to quality mode: E2E matrix, edge cases, measured optimisation. /quality fix also authorizes repairing named findings with the affected rows re-run.",
    handler: async (args: string, ctx: ExtensionCommandContext) => switchTo(pi, ctx, "quality", args.trim().toLowerCase().startsWith("fix")),
  });
}
