const STATUSES = new Set(["pending", "active", "done", "skipped"]);

export function createState() {
  return { items: [], nextId: 1 };
}

export function normalizeItems(items) {
  if (typeof items === "string") {
    try {
      const parsed = JSON.parse(items);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return items.split("\n").map((line) => line.trim()).filter(Boolean);
  }
  return items;
}

export function snapshot(state) {
  return structuredClone(state);
}

export function apply(state, input) {
  if (!input || typeof input.action !== "string") throw new Error("action is required");

  if (input.action === "initialize") {
    const items = normalizeItems(input.items);
    if (!Array.isArray(items) || items.length === 0 || items.some((text) => typeof text !== "string" || !text.trim())) {
      throw new Error("initialize requires a non-empty ordered items list");
    }
    return {
      items: items.map((text, index) => ({ id: index + 1, text, status: "pending" })),
      nextId: items.length + 1,
    };
  }

  const next = snapshot(state);
  if (input.action === "list") return next;

  const item = next.items.find((candidate) => candidate.id === input.id);
  if (!item) throw new Error("Unknown task item");

  if (input.action === "skip") {
    if (typeof input.reason !== "string" || !input.reason.trim()) throw new Error("Skipping requires a non-empty reason");
    item.status = "skipped";
    item.reason = input.reason.trim();
    return next;
  }

  if (input.action === "set_status") {
    if (!STATUSES.has(input.status)) throw new Error("Invalid status");
    if (input.status === "skipped" && (typeof input.reason !== "string" || !input.reason.trim())) {
      throw new Error("Skipping requires a non-empty reason");
    }
    item.status = input.status;
    if (input.status === "skipped") item.reason = input.reason.trim();
    else delete item.reason;
    return next;
  }

  throw new Error("Unknown action");
}
