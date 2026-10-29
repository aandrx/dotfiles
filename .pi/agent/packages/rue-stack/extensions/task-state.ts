import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { apply, createState, snapshot } from "./task-state-core.mjs";

const Params = Type.Object({
  action: Type.Union([
    Type.Literal("initialize"),
    Type.Literal("list"),
    Type.Literal("set_status"),
    Type.Literal("skip"),
  ], { description: "Action to perform" }),
  items: Type.Optional(Type.Array(Type.String(), { description: "Ordered checklist items for initialize" })),
  id: Type.Optional(Type.Number({ description: "Task item id for set_status or skip" })),
  status: Type.Optional(
    Type.Union([
      Type.Literal("pending"),
      Type.Literal("active"),
      Type.Literal("done"),
      Type.Literal("skipped"),
    ], { description: "New status for set_status" }),
  ),
  reason: Type.Optional(Type.String({ description: "Required when marking an item skipped" })),
});
export default function (pi: ExtensionAPI) {
  let state = createState();
  const reconstruct = (ctx: ExtensionContext) => {
    state = createState();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role === "toolResult" && msg.toolName === "rue_task_state" && msg.details) state = snapshot(msg.details as typeof state);
    }
  };
  pi.on("session_start", async (_event, ctx) => reconstruct(ctx));
  pi.on("session_tree", async (_event, ctx) => reconstruct(ctx));
  pi.registerTool({
    name: "rue_task_state", label: "Task state",
    description: "Track an ordered task checklist. Actions: initialize (items array, ordered verbatim), list, set_status (id, status, reason required for skipped), skip (id, reason).",
    parameters: Params,
    async execute(_id, p) {
      state = apply(state, p as Parameters<typeof apply>[1]);
      const details = snapshot(state);
      return { content: [{ type: "text", text: details.items.map(i => `${i.id}. ${i.status}: ${i.text}${i.reason ? ` (${i.reason})` : ""}`).join("\n") || "No task state" }], details };
    }
  });
}
