import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import dshCompaction from "../dsh-compaction.ts";
import dshJobs from "../dsh-jobs.ts";
import dshPlanMode from "../dsh-plan-mode.ts";
import dshPrefix from "../dsh-prefix.ts";
import dshSpill from "../dsh-spill.ts";
import dshTokenMeter from "../dsh-token-meter.ts";
import dshWorkflow from "../dsh-workflow.ts";
import dshAskUser from "../dsh-ask-user.ts";

export default function noop(): void {}
const isMain = !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  test("extensions register against only the mocked host seam", () => {
    const extensions = [dshCompaction, dshJobs, dshPlanMode, dshPrefix, dshSpill, dshTokenMeter, dshWorkflow, dshAskUser];
    for (const extension of extensions) {
      const registrations: string[] = [];
      const pi: any = {
        registerTool: (tool: any) => registrations.push(`tool:${tool.name}`),
        registerCommand: (name: string) => registrations.push(`command:${name}`),
        on: (event: string) => registrations.push(`event:${event}`),
        appendEntry: () => {},
        sendMessage: () => {},
        getAllTools: () => [],
      };
      assert.doesNotThrow(() => extension(pi));
      assert.ok(registrations.length > 0, "extension registered at least one host hook/tool/command");
    }
  });
}
