import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { injectPolicy } from "./global-policy.mjs";

export default function registerGlobalPolicy(pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => {
    injectPolicy(event);
  });
}
