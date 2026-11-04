#!/usr/bin/env node
/**
 * Re-applies the api-usage banner section to the active managed Pi release.
 *
 * Pi 1.5.0 executes a minified esbuild bundle (dist/bundle/chunks/*.js), not the
 * readable dist/modes/interactive/interactive-mode.js, so the anchor is matched
 * in whichever file owns it. Every update installs a fresh releases/<version>/
 * directory and only rewrites install/current-version, so the patch is re-applied
 * per release. The launcher that calls this script (~/.pi/agent/bin/pi) is
 * bootstrap output, not release output, so it survives updates.
 *
 * Usage: node pi-banner-usage.mjs [--revert] [--check]
 * Exit: 0 nothing to do or success, 1 failure (details in the log).
 */
import fs from 'node:fs';
import path from 'node:path';

const SELF = fs.realpathSync(process.argv[1]);
const AGENT_DIR = path.dirname(path.dirname(SELF));
const INSTALL_ROOT = process.env.PI_MANAGED_INSTALL_ROOT?.trim() || path.join(AGENT_DIR, 'install');
const LOG_PATH = path.join(AGENT_DIR, 'tmp', 'banner-usage-patch.log');

// The seam just after the Extensions section and before diagnostics. Unique in
// both the minified bundle and the unbundled module of 1.5.0.
const ANCHORS = ['if(showDiagnostics){', 'if (showDiagnostics) {'];
const MARKER = '/* [api-usage] */';
const END = '/* [/api-usage] */';

// Runs inside showLoadedResources(), where addLoadedSection, theme and
// getAgentDir are already in scope. Builtins come from process.getBuiltinModule
// so this does not depend on how the bundle names its own fs/path imports.
const SNIPPET =
    MARKER +
    'try{const _auf=process.getBuiltinModule("node:fs"),_aup=process.getBuiltinModule("node:path"),' +
    '_auc=_aup.join(getAgentDir(),"api-usage.cache");' +
    'if(_auf.existsSync(_auc)){const _aut=_auf.readFileSync(_auc,"utf8").trim();' +
    'if(_aut)addLoadedSection("Usage",()=>theme.fg("dim",_aut.split("\\n").map(_aul=>"  "+_aul).join("\\n")))}}catch{}' +
    END;

function log(message) {
    try {
        fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
        fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message}\n`);
    } catch {
        // logging must never block startup
    }
}

function resolveVersion() {
    let version;
    try {
        version = fs.readFileSync(path.join(INSTALL_ROOT, 'current-version'), 'utf8').trim();
    } catch (error) {
        return { error: `could not read current-version: ${error.message}` };
    }
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
        return { error: `invalid current-version: ${JSON.stringify(version)}` };
    }
    return { version };
}

function candidateFiles(version) {
    const distDir = path.join(INSTALL_ROOT, 'releases', version, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist');
    const files = [];
    const chunksDir = path.join(distDir, 'bundle', 'chunks');
    if (fs.existsSync(chunksDir)) {
        const chunks = fs
            .readdirSync(chunksDir)
            .filter((entry) => entry.endsWith('.js'))
            .map((entry) => path.join(chunksDir, entry));
        // The interactive chunk is the largest; try big files first to stop early.
        chunks.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
        files.push(...chunks);
    }
    // The bin entry imports the bundle, so the readable module is only a fallback
    // for a layout that runs it directly.
    const modesFile = path.join(distDir, 'modes', 'interactive', 'interactive-mode.js');
    if (fs.existsSync(modesFile)) files.push(modesFile);
    return files;
}

function statePath(version) {
    return path.join(INSTALL_ROOT, 'releases', version, '.api-usage-patch.json');
}

function readState(version) {
    try {
        const state = JSON.parse(fs.readFileSync(statePath(version), 'utf8'));
        if (state?.snippetHash !== hashSnippet() || typeof state.file !== 'string') return null;
        const stat = fs.statSync(state.file);
        if (stat.size !== state.size || stat.mtimeMs !== state.mtimeMs) return null;
        return state;
    } catch {
        return null;
    }
}

function writeState(version, file, patched) {
    if (!patched) {
        try {
            fs.rmSync(statePath(version), { force: true });
        } catch {
            // nothing to clean up
        }
        return;
    }
    try {
        const stat = fs.statSync(file);
        fs.writeFileSync(
            statePath(version),
            `${JSON.stringify({ file, size: stat.size, mtimeMs: stat.mtimeMs, snippetHash: hashSnippet() }, null, 2)}\n`,
        );
    } catch (error) {
        log(`could not write state: ${error.message}`);
    }
}

function hashSnippet() {
    return String(SNIPPET.length) + ':' + SNIPPET.slice(0, 24);
}

function findTarget(version) {
    for (const file of candidateFiles(version)) {
        let content;
        try {
            content = fs.readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        if (content.includes(MARKER)) return { file, content };
        if (ANCHORS.some((anchor) => content.includes(anchor))) return { file, content };
    }
    return null;
}

function applyTo(file, content) {
    const existing = content.indexOf(MARKER);
    if (existing !== -1) {
        const end = content.indexOf(END, existing);
        if (end === -1) return { content, changed: false, error: 'marker without end tag' };
        const current = content.slice(existing, end + END.length);
        if (current === SNIPPET) return { content, changed: false };
        return { content: content.slice(0, existing) + SNIPPET + content.slice(end + END.length), changed: true };
    }
    for (const anchor of ANCHORS) {
        const index = content.indexOf(anchor);
        if (index === -1) continue;
        const lineStart = content.lastIndexOf('\n', index - 1) + 1;
        const prefix = content.slice(lineStart, index);
        const indent = /^\s*$/.test(prefix) ? prefix : '';
        return { content: content.slice(0, index) + SNIPPET + '\n' + indent + content.slice(index), changed: true };
    }
    return { content, changed: false, error: 'anchor not found' };
}

function revertFrom(file, content) {
    const start = content.indexOf(MARKER);
    if (start === -1) return { content, changed: false };
    const end = content.indexOf(END, start);
    if (end === -1) return { content, changed: false, error: 'marker without end tag' };
    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const indent = content.slice(lineStart, start);
    const from = /^\s*$/.test(indent) ? lineStart : start;
    return { content: content.slice(0, from) + content.slice(end + END.length), changed: true };
}

function main() {
    const mode = process.argv.includes('--revert') ? 'revert' : process.argv.includes('--check') ? 'check' : 'apply';
    const resolved = resolveVersion();
    if (resolved.error) {
        log(`${mode}: ${resolved.error}`);
        return mode === 'check' ? 1 : 0;
    }
    const { version } = resolved;

    const state = readState(version);
    if (state) {
        if (mode === 'check') {
            process.stdout.write(`${version}: patched (${path.basename(state.file)})\n`);
            return 0;
        }
        if (mode === 'revert') {
            try {
                const content = fs.readFileSync(state.file, 'utf8');
                const result = revertFrom(state.file, content);
                if (result.changed) fs.writeFileSync(state.file, result.content);
                writeState(version, state.file, false);
                process.stdout.write(`reverted ${version}\n`);
                return 0;
            } catch (error) {
                log(`revert: could not revert ${state.file}: ${error.message}`);
                return 1;
            }
        }
        return 0;
    }

    const target = findTarget(version);
    if (!target) {
        log(`${mode}: no anchor found for ${version}; leaving it unpatched`);
        return 1;
    }

    if (mode === 'check') {
        const patched = target.content.includes(MARKER);
        process.stdout.write(`${version}: ${patched ? 'patched' : 'not patched'} (${path.basename(target.file)})\n`);
        return patched ? 0 : 1;
    }

    const result = mode === 'revert' ? revertFrom(target.file, target.content) : applyTo(target.file, target.content);
    if (result.error) {
        log(`${mode}: ${result.error} in ${target.file}`);
        return 1;
    }
    if (result.changed) {
        try {
            fs.writeFileSync(target.file, result.content);
        } catch (error) {
            log(`${mode}: could not write ${target.file}: ${error.message}`);
            return 1;
        }
        process.stdout.write(`${mode === 'revert' ? 'reverted' : 'patched'} ${version} (${path.basename(target.file)})\n`);
    }
    writeState(version, target.file, mode !== 'revert');
    return 0;
}

process.exitCode = main();
