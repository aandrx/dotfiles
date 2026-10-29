import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const BAR_WIDTH = 20;
const MIN_BAR_WIDTH = 5;

function fmtTokens(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

export default function (pi: ExtensionAPI) {
	let redraw = () => {};
	pi.on("thinking_level_select", async () => redraw());

	let ctxRef: any;
	pi.on("session_start", async (_event, ctx) => {
		ctxRef = ctx;
		ctx.ui.setFooter((tui, theme, footerData) => {
			redraw = () => tui.requestRender();
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					let cost = 0;
					let tokIn = 0;
					let tokCache = 0;
					let tokWrite = 0;
					let lastCacheRead = 0;
					let tokOut = 0;
					let firstTs = 0;
					let lastTs = 0;
					let mode = "off";
					let sessionTitle = "";
					let liveSessionName = "";
					let taskDone = 0;
					let taskTotal = 0;
					for (const e of ctx.sessionManager.getBranch()) {
						if (e.type === "custom" && (e as any).customType === "rue-stack-mode") {
							const m = (e as any).data?.mode;
							if (typeof m === "string") mode = m;
						}
						if (e.type === "session_info" && (e as any).name) {
							liveSessionName = String((e as any).name);
						}
						if (e.type === "message" && e.message.role === "user") {
							const c: any = (e.message as any).content;
							const raw = typeof c === "string"
								? c
								: Array.isArray(c)
									? c.filter((b: any) => b?.type === "text").map((b: any) => b.text ?? "").join(" ")
									: "";
							if (raw.trim()) sessionTitle = raw.trim().replace(/\s+/g, " ").slice(0, 34);
						}
						if (e.type === "message" && e.message.role === "assistant") {
							const m = e.message as AssistantMessage;
							cost += m.usage.cost.total;
							tokIn += m.usage.input ?? 0;
							tokCache += m.usage.cacheRead ?? 0;
							tokWrite += m.usage.cacheWrite ?? 0;
							lastCacheRead = m.usage.cacheRead ?? lastCacheRead;
							tokOut += m.usage.output ?? 0;
							const ts = typeof m.timestamp === "number" ? m.timestamp : Date.parse(String(m.timestamp ?? ""));
							if (Number.isFinite(ts) && ts > 0) {
								if (firstTs === 0 || ts < firstTs) firstTs = ts;
								if (ts > lastTs) lastTs = ts;
							}
						}
						if (e.type === "message" && e.message.role === "toolResult" && (e.message as any).toolName === "rue_task_state") {
							const items = (e.message as any).details?.items;
							if (Array.isArray(items) && items.length > 0) {
								taskTotal = items.length;
								taskDone = items.filter((i: any) => i.status === "done" || i.status === "skipped").length;
							}
						}
					}

					const contextUsage = ctx.getContextUsage();
					const used = contextUsage?.tokens ?? 0;
					const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					// percent is null when the token count is unknown, e.g. right after compaction
					const pctUsed = Math.min(100, Math.max(0, contextUsage?.percent ?? (contextWindow > 0 ? (used / contextWindow) * 100 : 0)));
					const barColor = pctUsed >= 80 ? "error" : pctUsed >= 50 ? "warning" : "success";
					// Share of the live context served from cache, from the newest request.
					const cachedShare = used > 0 ? Math.min(1, Math.max(0, lastCacheRead / used)) : 0;
					const bar = (size: number) => {
						const filled = Math.round((pctUsed / 100) * size);
						const cached = Math.round(cachedShare * filled);
						return (
							theme.fg("mdCode", "█".repeat(cached)) +
							theme.fg(barColor, "█".repeat(Math.max(0, filled - cached))) +
							theme.fg("dim", "░".repeat(size - filled))
						);
					};

					const branch = footerData.getGitBranch();
					const branchSeg = theme.fg("mdLink", branch ? `⎇ ${branch}` : "no git");
					// The thinking level only means something for models that can think
					const level = String(pi.getThinkingLevel() ?? "");
					// Pi tints the input border with these same theme keys, so the footer matches it.
					const levelKey =
						level === "minimal" ? "thinkingMinimal"
						: `thinking${level.charAt(0).toUpperCase()}${level.slice(1)}`;
					const paint = (s: string) => {
						try { return theme.fg(levelKey, s); } catch { return theme.fg("muted", s); }
					};
					const thinking = ctx.model?.reasoning ? paint(` · ${level}`) : "";
					const modelSeg = theme.fg("accent", `${ctx.model?.provider ?? "?"}/${ctx.model?.id ?? "none"}`) + thinking;
					const contextSeg = (barSize: number) =>
						theme.fg("muted", "[") +
						bar(barSize) +
						theme.fg("muted", "] ") +
						theme.fg("mdCode", `${fmtTokens(used)}/${fmtTokens(contextWindow)}`) +
						theme.fg(barColor, ` (${pctUsed.toFixed(0)}%)`);
					const costSeg = theme.fg("success", `$${cost.toFixed(3)}`);
					// DeepSeek-metric: cache reads over all billed prompt-side tokens.
					const cacheBase = tokIn + tokCache + tokWrite;
					const cachePct = cacheBase > 0 ? (tokCache / cacheBase) * 100 : 0;
					const cacheText = cacheBase <= 0
						? "--"
						: cachePct >= 99.95
							? "100"
							: cachePct.toFixed(0) === "100"
								? cachePct.toFixed(1)
								: cachePct.toFixed(0);
					const elapsedS = lastTs > firstTs ? (lastTs - firstTs) / 1000 : 0;
					const tps = elapsedS > 0 ? tokOut / elapsedS : 0;
					const perfSeg = theme.fg("muted", `CH ${cacheText}% · ${tps.toFixed(0)} tok/s`);
					const modeColor = mode === "off" ? "dim" : mode === "quality" ? "warning" : "accent";
					const modeSeg = theme.fg(modeColor, mode === "off" ? "off" : `● ${mode}`);
					const taskSeg = taskTotal > 0 ? theme.fg(taskDone === taskTotal ? "success" : "muted", `☑ ${taskDone}/${taskTotal}`) : "";

					const sep = theme.fg("dim", " │ ");
					const segs = [modeSeg, modelSeg, branchSeg, contextSeg(BAR_WIDTH), costSeg];
					if (taskSeg) segs.splice(1, 0, taskSeg);
					const line = (barSize: number) => {
						const parts = [modeSeg];
						if (taskSeg) parts.push(taskSeg);
						const liveName = liveSessionName || (() => {
							try { return ctxRef?.runtime?.getSessionName?.() ?? ""; } catch { return ""; }
						})();
						const label = liveName || sessionTitle;
						if (label) parts.push(theme.fg("muted", label));
						parts.push(modelSeg, branchSeg, contextSeg(barSize), costSeg, perfSeg);
						return parts.join(sep);
					};

					// Shrink the bar before cutting anything off, so the cost stays visible in narrow windows
					const overflow = visibleWidth(line(BAR_WIDTH)) - width;
					const barSize = Math.max(MIN_BAR_WIDTH, BAR_WIDTH - Math.max(0, overflow));
					return [truncateToWidth(line(barSize), width)];
				},
			};
		});
	});
}
