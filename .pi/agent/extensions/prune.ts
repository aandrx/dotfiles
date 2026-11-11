/**
 * /prune - rewrite the active session to the context Pi actually replays.
 *
 * Compaction only changes what is sent to the model; the JSONL keeps every old
 * entry forever, so long sessions keep getting slower to load and render.
 *
 * Default (in place): rewrite the current session file, archive the old file
 * under .prune-archive/, and reload that same path. The session keeps its id,
 * file name, and display name.
 *
 * `/prune copy`: write a new session file and switch to it instead. The
 * original is left untouched and the new session gets a " [pruned]" name.
 *
 * `/prune status`: report what would be dropped without writing anything.
 *
 * Either way, the candidate is verified against Pi's own session projection
 * before anything is replaced or switched. If the model input would differ,
 * the command aborts and changes nothing.
 *
 * Requires at least one compaction on the active branch. Run /compact first if
 * /prune reports that there is nothing to drop. Prune only removes already
 * summarized history; it cannot shrink the live retained window. Use /compact
 * for that, then /prune again.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

const PRUNED_SUFFIX = " [pruned]";
/** Skip rewriting when the result would save less than this fraction. */
const MIN_SAVINGS = 0.02;

type PruneMode = "inplace" | "copy" | "status";

function size(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} kB`;
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1_000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function notify(
  ctx: ExtensionCommandContext,
  message: string,
  type: "info" | "warning" | "error",
): void {
  try {
    ctx.ui.notify(message, type);
  } catch {
    // The context can be invalid after a session switch; the command is done.
  }
}

function parseMode(arg: string): PruneMode {
  const value = arg.trim().toLowerCase();
  if (value === "copy" || value === "new") return "copy";
  if (value === "status" || value === "dry-run" || value === "--dry-run") return "status";
  return "inplace";
}

function prunedName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const base = name.endsWith(PRUNED_SUFFIX) ? name.slice(0, -PRUNED_SUFFIX.length) : name;
  return `${base}${PRUNED_SUFFIX}`;
}

function liveSummary(ctx: ExtensionCommandContext): string {
  const messages = ctx.sessionManager.buildSessionProjection().messages.length;
  const usage = ctx.getContextUsage();
  if (!usage) return `${messages} live messages`;
  const percent =
    typeof usage.percent === "number" ? `${Math.round(usage.percent)}%` : "?";
  return `${messages} live messages, ${fmtTokens(usage.tokens)}/${fmtTokens(usage.contextWindow)} tokens (${percent})`;
}

interface PrunePlan {
  entries: SessionEntry[];
  dropped: number;
}

function planPrune(sm: ExtensionCommandContext["sessionManager"]): PrunePlan | string {
  const branch = sm.getBranch();
  if (branch.length === 0) return "session is empty";

  let compactionIndex = -1;
  for (let i = branch.length - 1; i >= 0; i--) {
    if (branch[i].type === "compaction") {
      compactionIndex = i;
      break;
    }
  }
  if (compactionIndex < 0) {
    return "no compaction on the active branch; run /compact first, then /prune";
  }

  const compaction = branch[compactionIndex];
  const firstKept = compaction.type === "compaction" ? compaction.firstKeptEntryId : null;
  let start = compactionIndex;
  if (firstKept && firstKept !== compaction.id) {
    start = branch.findIndex((entry) => entry.id === firstKept);
    if (start < 0) {
      return "compaction firstKeptEntryId is not on the active branch; refusing to prune";
    }
  }

  const kept = branch.slice(start).map((entry, index) => ({
    ...entry,
    parentId: index === 0 ? null : entry.parentId,
  }));

  return { entries: kept, dropped: start };
}

function lastEntry<T extends SessionEntry["type"]>(
  branch: SessionEntry[],
  type: T,
): Extract<SessionEntry, { type: T }> | undefined {
  for (let i = branch.length - 1; i >= 0; i--) {
    if (branch[i].type === type) return branch[i] as Extract<SessionEntry, { type: T }>;
  }
  return undefined;
}

function projectionMismatch(
  expected: ReturnType<ExtensionCommandContext["sessionManager"]["buildSessionProjection"]>,
  actual: ReturnType<ExtensionCommandContext["sessionManager"]["buildSessionProjection"]>,
): string | null {
  if (JSON.stringify(expected.messages) !== JSON.stringify(actual.messages)) {
    return `context messages differ (${expected.messages.length} before, ${actual.messages.length} after)`;
  }
  if (JSON.stringify(expected.model) !== JSON.stringify(actual.model)) {
    return `model differs (${JSON.stringify(expected.model)} before, ${JSON.stringify(actual.model)} after)`;
  }
  if (expected.thinkingLevel !== actual.thinkingLevel) {
    return `thinking level differs (${expected.thinkingLevel} before, ${actual.thinkingLevel} after)`;
  }
  return null;
}

interface BuiltFile {
  content: string;
  bytes: number;
  targetPath: string;
  archivePath?: string;
}

function archivePathFor(sessionDir: string, sourcePath: string, stamp: string, tag: string): string {
  return join(
    sessionDir,
    ".prune-archive",
    `${basename(sourcePath)}.${stamp}.${tag}.bak`,
  );
}

function buildFile(
  ctx: ExtensionCommandContext,
  mode: PruneMode,
  plan: PrunePlan,
  sourcePath: string,
  now: string,
  stamp: string,
): BuiltFile {
  const sm = ctx.sessionManager;
  const originalHeader = sm.getHeader();
  const id = mode === "inplace" ? sm.getSessionId() : randomUUID();
  const name = mode === "inplace" ? sm.getSessionName() : prunedName(sm.getSessionName());
  const fullBranch = sm.getBranch();

  // Keep the active model and thinking level when their latest changes sit in
  // the summarized prefix. These entries are metadata and add no model context.
  const extras: SessionEntry[] = [];
  if (!plan.entries.some((entry) => entry.type === "thinking_level_change")) {
    const lastThinking = lastEntry(fullBranch, "thinking_level_change");
    if (lastThinking) extras.push({ ...lastThinking, parentId: null });
  }
  const keptHasModel =
    plan.entries.some((entry) => entry.type === "model_change") ||
    plan.entries.some((entry) => entry.type === "message" && entry.message.role === "assistant");
  if (!keptHasModel) {
    const lastModel = lastEntry(fullBranch, "model_change");
    if (lastModel) extras.push({ ...lastModel, parentId: null });
  }
  let parentId = plan.entries[plan.entries.length - 1]?.id ?? null;
  for (const extra of extras) {
    extra.parentId = parentId;
    parentId = extra.id;
  }

  const header: Record<string, unknown> = mode === "inplace" && originalHeader
    ? {
        ...originalHeader,
        type: "session",
        version: 3,
        id,
        timestamp: originalHeader.timestamp,
        cwd: sm.getCwd(),
      }
    : {
        type: "session",
        version: 3,
        id,
        timestamp: now,
        cwd: sm.getCwd(),
        parentSession: sourcePath,
      };

  const lines: string[] = [JSON.stringify(header)];
  for (const entry of plan.entries) lines.push(JSON.stringify(entry));
  for (const extra of extras) lines.push(JSON.stringify(extra));
  if (name && !plan.entries.some((entry) => entry.type === "session_info" && entry.name === name)) {
    lines.push(
      JSON.stringify({
        type: "session_info",
        id: randomUUID().replace(/-/g, "").slice(0, 8),
        parentId,
        timestamp: now,
        name,
      }),
    );
  }

  const content = `${lines.join("\n")}\n`;
  const sessionDir = sm.getSessionDir();
  const targetPath =
    mode === "inplace"
      ? sourcePath
      : join(sessionDir, `${stamp}_${id}.jsonl`);
  const archivePath =
    mode === "inplace"
      ? archivePathFor(sessionDir, sourcePath, stamp, "original")
      : undefined;
  return { content, bytes: Buffer.byteLength(content), targetPath, archivePath };
}

function verifyCandidate(
  ctx: ExtensionCommandContext,
  tempPath: string,
): string | null {
  try {
    const expected = ctx.sessionManager.buildSessionProjection();
    const candidate = SessionManager.open(tempPath).buildSessionProjection();
    return projectionMismatch(expected, candidate);
  } catch (error) {
    return `verification failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function discard(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // An inert temp file is better than masking the original error.
  }
}

async function pruneInPlace(
  ctx: ExtensionCommandContext,
  sourcePath: string,
  built: BuiltFile,
  tempPath: string,
  stamp: string,
  before: number,
  dropped: number,
): Promise<void> {
  const archive = built.archivePath;
  if (!archive) return;

  mkdirSync(dirname(archive), { recursive: true, mode: 0o700 });
  try {
    renameSync(sourcePath, archive);
  } catch (error) {
    discard(tempPath);
    notify(
      ctx,
      `prune: could not archive ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
    return;
  }

  try {
    renameSync(tempPath, sourcePath);
  } catch (error) {
    try {
      renameSync(archive, sourcePath);
    } catch {
      // Report both paths below; the original is still in the archive.
    }
    notify(
      ctx,
      `prune: could not replace ${sourcePath}: ${error instanceof Error ? error.message : String(error)}. Original archive: ${archive}`,
      "error",
    );
    return;
  }

  const success = `prune: ${size(before)} -> ${size(built.bytes)} in place, dropped ${dropped} entries. Archive: ${archive}`;

  try {
    const result = await ctx.switchSession(sourcePath, {
      withSession: async (fresh) => {
        try {
          fresh.ui.notify(success, "info");
        } catch {
          // The switch already succeeded; a failed notice is not fatal.
        }
      },
    });
    if (result.cancelled) {
      // The switch was cancelled before teardown, so the live session still
      // matches the original file. Put it back.
      const failed = archivePathFor(
        ctx.sessionManager.getSessionDir(),
        sourcePath,
        stamp,
        "pruned",
      );
      try {
        renameSync(sourcePath, failed);
      } catch {
        // Continue; restoring the original matters more.
      }
      try {
        renameSync(archive, sourcePath);
        notify(ctx, "prune: switch cancelled; original session restored", "warning");
      } catch (error) {
        notify(
          ctx,
          `prune: switch cancelled and restore failed: ${error instanceof Error ? error.message : String(error)}. Original: ${archive}`,
          "error",
        );
      }
    }
  } catch (error) {
    notify(
      ctx,
      `prune: file replaced but switch failed: ${error instanceof Error ? error.message : String(error)}. Original archive: ${archive}`,
      "error",
    );
  }
}

async function pruneCopy(
  ctx: ExtensionCommandContext,
  sourcePath: string,
  built: BuiltFile,
  tempPath: string,
  before: number,
  dropped: number,
): Promise<void> {
  try {
    renameSync(tempPath, built.targetPath);
  } catch (error) {
    discard(tempPath);
    notify(
      ctx,
      `prune: could not finalize ${built.targetPath}: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
    return;
  }
  try {
    chmodSync(built.targetPath, 0o600);
  } catch {
    // Rename already produced the file; mode is best effort.
  }

  const success = `prune: ${size(before)} -> ${size(built.bytes)}, dropped ${dropped} entries. Wrote ${built.targetPath}. Original untouched: ${sourcePath}`;

  try {
    const result = await ctx.switchSession(built.targetPath, {
      withSession: async (fresh) => {
        try {
          fresh.ui.notify(success, "info");
        } catch {
          // The switch already succeeded; a failed notice is not fatal.
        }
      },
    });
    if (result.cancelled) {
      notify(
        ctx,
        `prune: switch cancelled; new file kept at ${built.targetPath}`,
        "warning",
      );
    }
  } catch (error) {
    notify(
      ctx,
      `prune: wrote ${built.targetPath} but switch failed: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
  }
}

async function prune(ctx: ExtensionCommandContext, arg: string): Promise<void> {
  if (!ctx.isIdle()) {
    await ctx.waitForIdle();
  }

  const mode = parseMode(arg);
  const sm = ctx.sessionManager;
  const sourcePath = sm.getSessionFile();
  if (!sourcePath) {
    notify(ctx, "prune: ephemeral session, nothing to write", "warning");
    return;
  }

  const plan = planPrune(sm);
  if (typeof plan === "string") {
    notify(ctx, `prune: ${plan}. ${liveSummary(ctx)}.`, "warning");
    return;
  }

  let before: number;
  try {
    before = statSync(sourcePath).size;
  } catch (error) {
    notify(
      ctx,
      `prune: could not read ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
    return;
  }

  const now = new Date().toISOString();
  const stamp = now.replace(/[:.]/g, "-");
  const built = buildFile(ctx, mode, plan, sourcePath, now, stamp);
  const savings = before > 0 ? 1 - built.bytes / before : 0;

  if (mode === "status") {
    const saved = Math.max(0, before - built.bytes);
    notify(
      ctx,
      `prune status: ${size(before)} -> ${size(built.bytes)} (${saved > 0 ? `save ${size(saved)}` : "no meaningful savings"}), ${plan.dropped} entries before the retained window. ${liveSummary(ctx)}. No changes.`,
      "info",
    );
    return;
  }

  if (savings < MIN_SAVINGS) {
    notify(
      ctx,
      `prune: no meaningful dead history (${size(before)}, ${plan.dropped} entries before the retained window). ${liveSummary(ctx)}. Run /compact to shrink the live window, then /prune again.`,
      "info",
    );
    return;
  }

  const tempPath = `${built.targetPath}.prune-${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tempPath, built.content, { mode: 0o600 });

  const mismatch = verifyCandidate(ctx, tempPath);
  if (mismatch) {
    discard(tempPath);
    notify(ctx, `prune: aborted, nothing changed (${mismatch})`, "error");
    return;
  }

  if (mode === "inplace") {
    await pruneInPlace(ctx, sourcePath, built, tempPath, stamp, before, plan.dropped);
  } else {
    await pruneCopy(ctx, sourcePath, built, tempPath, before, plan.dropped);
  }
}

export default function pruneSession(pi: ExtensionAPI): void {
  pi.registerCommand("prune", {
    description:
      "Rewrite the active session to its retained compaction window (in place; pass 'copy' for a new session, 'status' for a dry run)",
    handler: async (args, ctx) => {
      await prune(ctx, args);
    },
  });
}
