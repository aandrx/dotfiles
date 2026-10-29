import fs from 'fs';
import path from 'path';
import os from 'os';

const CORE_FILE = path.join(os.homedir(), '.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js');

// Patch #1: Header Removal
const HEADER_ANCHOR = '// Add header with keybindings from config (unless silenced)';
const HEADER_FROM = 'if (this.options.verbose || !this.settingsManager.getQuietStartup()) {';
const HEADER_TO = 'if (this.options.verbose) {';

// Patch #2: Usage Section Insertion
const USAGE_ANCHOR = '// Show loaded themes (excluding built-in)';
const USAGE_MARKER = '// [api-usage] usage line (custom patch)';
const USAGE_SNIPPET = `
            ${USAGE_MARKER}
            const usageCache = (() => {
                try {
                    const p = path.join(getAgentDir(), "api-usage.cache");
                    if (!fs.existsSync(p)) return null;
                    const t = fs.readFileSync(p, "utf8").trim();
                    return t.length > 0 ? t : null;
                }
                catch { return null; }
            })();
            if (usageCache != null) {
                const usageLines = usageCache.split("\\n").map((line) => \`  \${line}\`).join("\\n");
                addLoadedSection("Usage", theme.fg("dim", usageLines));
            }
`;


function applyPatch(content, anchor, from, to, snippet = null) {
    const anchorIdx = content.indexOf(anchor);
    if (anchorIdx === -1) return { content, patched: false, error: 'Anchor not found' };

    if (snippet) {
        // Insertion patch (Patch #2)
        if (content.includes(USAGE_MARKER)) return { content, patched: false, error: 'Already patched' };
        const absoluteAnchorIdx = anchorIdx;
        const newContent = content.slice(0, absoluteAnchorIdx) + snippet + content.slice(absoluteAnchorIdx);
        return { content: newContent, patched: true };
    } else {
        // Replacement patch (Patch #1)
        const afterAnchor = content.slice(anchorIdx);
        if (afterAnchor.includes(to) && !afterAnchor.includes(from)) {
            return { content, patched: false, error: 'Already patched' };
        }
        const fromIdx = afterAnchor.indexOf(from);
        if (fromIdx === -1) return { content, patched: false, error: 'Pattern not found' };
        const absoluteFromIdx = anchorIdx + fromIdx;
        const newContent = content.slice(0, absoluteFromIdx) + to + content.slice(absoluteFromIdx + from.length);
        return { content: newContent, patched: true };
    }
}

function revertPatch(content, anchor, to, from, marker = null) {
    const anchorIdx = content.indexOf(anchor);
    if (anchorIdx === -1) return { content, reverted: false, error: 'Anchor not found' };

    if (marker) {
        // Removal of snippet (Patch #2)
        const markerIdx = content.indexOf(marker);
        if (markerIdx === -1) return { content, reverted: false, error: 'Not patched' };
        const start = markerIdx;
        const end = content.indexOf(USAGE_ANCHOR, start);
        if (start === -1 || end === -1) return { content, reverted: false, error: 'Marker/Anchor mismatch' };
        const newContent = content.slice(0, start) + content.slice(end);
        return { content: newContent, reverted: true };
    } else {
        // Restore condition (Patch #1)
        const afterAnchor = content.slice(anchorIdx);
        if (!afterAnchor.includes(to)) return { content, reverted: false, error: 'Not patched' };
        const toIdx = afterAnchor.indexOf(to);
        const absoluteToIdx = anchorIdx + toIdx;
        const newContent = content.slice(0, absoluteToIdx) + from + content.slice(absoluteToIdx + to.length);
        return { content: newContent, reverted: true };
    }
}

async function main() {
    const cmd = process.argv[2];
    if (!cmd) {
        console.log('Usage: node pi-startup.mjs <apply|revert>');
        process.exit(1);
    }

    let coreContent = "";
    if (fs.existsSync(CORE_FILE)) coreContent = fs.readFileSync(CORE_FILE, 'utf8');
    
    let coreModified = false;

    if (cmd === 'apply') {
        // Patch #1: Header
        if (coreContent) {
            const res1 = applyPatch(coreContent, HEADER_ANCHOR, HEADER_FROM, HEADER_TO);
            if (res1.patched) { coreContent = res1.content; coreModified = true; console.log('Header patch applied.'); }
            else if (res1.error !== 'Already patched') console.error(`Header patch error: ${res1.error}`);
        }

        // Patch #2: Usage
        if (coreContent) {
            const res2 = applyPatch(coreContent, USAGE_ANCHOR, null, null, USAGE_SNIPPET);
            if (res2.patched) { coreContent = res2.content; coreModified = true; console.log('Usage section patch applied.'); }
            else if (res2.error !== 'Already patched') console.error(`Usage patch error: ${res2.error}`);
        }

    } else if (cmd === 'revert') {
        // Revert #1: Header
        if (coreContent) {
            const res1 = revertPatch(coreContent, HEADER_ANCHOR, HEADER_TO, HEADER_FROM);
            if (res1.reverted) { coreContent = res1.content; coreModified = true; console.log('Header patch reverted.'); }
            else if (res1.error !== 'Not patched') console.error(`Header revert error: ${res1.error}`);
        }

        // Revert #2: Usage
        if (coreContent) {
            const res2 = revertPatch(coreContent, USAGE_ANCHOR, null, null, USAGE_MARKER);
            if (res2.reverted) { coreContent = res2.content; coreModified = true; console.log('Usage section patch reverted.'); }
            else if (res2.error !== 'Not patched') console.error(`Usage revert error: ${res2.error}`);
        }

    }

    if (coreModified) fs.writeFileSync(CORE_FILE, coreContent);
    if (coreModified) console.log('Changes saved.');
    else console.log('No changes needed.');
}

main();