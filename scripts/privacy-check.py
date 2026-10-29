#!/usr/bin/env python3
"""Privacy and portability checks for tracked dotfiles.

Findings are metadata only: repository-relative path, line when available, and
rule name. Credential values are never printed.

Usage:
  python3 scripts/privacy-check.py
  python3 scripts/privacy-check.py --staged
  python3 scripts/privacy-check.py --file REL SOURCE
  python3 scripts/privacy-check.py --denied REL
"""

from __future__ import annotations

import argparse
import ipaddress
import os
import posixpath
import re
import stat
import subprocess
import sys
from pathlib import Path
from typing import Iterable, NamedTuple

MAX_FILE_BYTES = 2 * 1024 * 1024
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
PNG_LOCATIONS = (
    ".config/swaync/icons/",
    ".config/swaync/images/",
    ".config/waybar/assets/",
    ".config/wlogout/icons/",
)
PLACEHOLDER_VALUES = {
    "null",
    "true",
    "false",
    "none",
    "undefined",
    "changeme",
    "change-me",
    "password",
    "secret",
    "example",
    "placeholder",
    "redacted",
    "dummy",
    "sample",
    "xxxxxxxx",
    "replace-me",
    "your-password",
    "your_password",
    "your-secret",
    "your_secret",
}
CREDENTIAL_DIRS = {".ssh", ".password-store", ".aws", ".gnupg", "keyrings"}
CREDENTIAL_BASENAMES = {
    ".netrc",
    ".git-credentials",
    ".env",
    "id_rsa",
    "id_ed25519",
    "id_ecdsa",
    "id_dsa",
    "credentials",
    "cookies.txt",
    "cookies.sqlite",
    "auth.json",
    "models.json",
    "models-store.json",
    "trust.json",
}


class Finding(NamedTuple):
    path: str
    line: int | None
    rule: str


DENIED_EXACT = {
    ".git-credentials",
    ".netrc",
    ".bash_history",
    ".zsh_history",
    ".python_history",
    ".node_repl_history",
    ".lesshst",
    ".viminfo",
    ".wget-hsts",
    ".bashrc.local",
    ".zshrc.local",
    ".profile.local",
    ".gitconfig.local",
    ".config/gh/hosts.yml",
    ".docker/config.json",
    ".kube/config",
    ".pi/agent/auth.json",
    ".pi/agent/models.json",
    ".pi/agent/models-store.json",
    ".pi/agent/trust.json",
    ".pi/agent/ui-panels.json",
    ".pi/agent/api-usage.cache",
    ".pi/agent/opencode-bridge-policy.log",
    ".pi/agent/machine-idle-plan.md",
    ".pi/agent/dsh-sync-plan.md",
    ".pi/agent/unfinished-work.md",
    "system/etc/default/grub",
}

DENIED_PREFIXES = (
    ".ssh/",
    ".password-store/",
    ".aws/",
    ".gnupg/",
    ".local/share/keyrings/",
    ".config/gcloud/",
    ".pi/agent/sessions/",
    ".pi/agent/spill/",
    ".pi/agent/checkpoints/",
    ".pi/agent/backups/",
    ".pi/agent/cache/",
    ".pi/agent/tmp/",
    ".pi/agent/install/",
    ".pi/agent/npm/",
    ".pi/agent/git/",
    ".pi/agent/skills/frontend-design/",
)

DENIED_COMPONENTS = {
    "node_modules",
    "__pycache__",
    "backups",
}

DENIED_SUFFIXES = (
    ".pem",
    ".key",
    ".p12",
    ".pfx",
    ".ppk",
    ".jks",
    ".keystore",
    ".bak",
    ".backup",
    ".orig",
    ".rej",
    ".swp",
    ".swo",
    ".tmp",
    ".log",
    ".pid",
    ".sock",
    ".tar",
    ".tar.gz",
    ".tgz",
    ".zip",
    ".7z",
    ".rar",
)

SECRET_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("github-token", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b")),
    ("github-token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b")),
    ("npm-token", re.compile(r"\bnpm_[A-Za-z0-9]{20,}\b")),
    ("gitlab-token", re.compile(r"\bglpat-[A-Za-z0-9_-]{20,}\b")),
    ("google-api-key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("slack-token", re.compile(r"\bxox[baprs]-[0-9A-Za-z-]{10,}\b")),
    ("aws-access-key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    (
        "jwt",
        re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
    ),
    ("private-key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("openai-token", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b")),
)

ASSIGN_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "registry-auth",
        re.compile(
            r"(?i)(?<![A-Za-z0-9])[\"']?_?authToken[\"']?\s*[:=]\s*[\"']?([^\s\"']{8,})"
        ),
    ),
    (
        "password-assignment",
        re.compile(
            r"(?i)(?<![\w.-])[\"']?(?:password|passwd)[\"']?\s*[:=]\s*[\"']?([^\s\"']{8,})"
        ),
    ),
    (
        "secret-assignment",
        re.compile(
            r"(?i)(?<![\w.-])[\"']?(?:client_secret|api_secret|secret)[\"']?\s*[:=]\s*[\"']?([^\s\"']{8,})"
        ),
    ),
)

NONPORTABLE_HOME = re.compile(r"/(?:home|Users)/([A-Za-z0-9._-]+)")
HOME_PLACEHOLDERS = {
    "user",
    "username",
    "youruser",
    "your-name",
    "your_username",
    "example",
    "runner",
}
IPV4 = re.compile(r"(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3})(?![\d.])")
PRIVATE_NETWORKS = tuple(
    ipaddress.ip_network((int.from_bytes(bytes(octets), "big"), prefix))
    for octets, prefix in (
        ((10, 0, 0, 0), 8),
        ((172, 16, 0, 0), 12),
        ((192, 168, 0, 0), 16),
        ((100, 64, 0, 0), 10),
    )
)
UUID = re.compile(
    r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"
)


def normalize_rel(value: str) -> str:
    value = value.replace(os.sep, "/")
    while value.startswith("./"):
        value = value[2:]
    return posixpath.normpath(value)


def denied_rule(rel: str) -> str | None:
    rel = normalize_rel(rel)
    if rel in DENIED_EXACT:
        return "denied-path"
    for prefix in DENIED_PREFIXES:
        if rel == prefix.rstrip("/") or rel.startswith(prefix):
            return "denied-path"
    parts = rel.split("/")
    if any(part in DENIED_COMPONENTS for part in parts):
        return "denied-path"
    if any(part.startswith(".dotfiles-backup-") for part in parts):
        return "denied-path"
    base = parts[-1]
    if base == ".env" or (base.startswith(".env.") and base != ".env.example"):
        return "denied-path"
    if base.startswith("wifi-") and base.endswith(".md"):
        return "denied-path"
    lowered = base.lower()
    if lowered in {"cookies.txt", "cookies.sqlite"} or "cookies" in parts:
        return "denied-path"
    if lowered.endswith(".cookie"):
        return "denied-path"
    for suffix in DENIED_SUFFIXES:
        if lowered.endswith(suffix):
            return "denied-path"
    return None


def plausible_secret(value: str) -> bool:
    value = value.strip().strip("\"'")
    if len(value) < 8:
        return False
    if value.startswith(("$", "{", "<", "%", "!")):
        return False
    lowered = value.lower()
    if lowered in PLACEHOLDER_VALUES:
        return False
    if lowered.startswith(("process.env.", "os.environ", "env:", "env.")):
        return False
    return True


def scan_gitconfig(rel: str, text: str) -> list[Finding]:
    findings: list[Finding] = []
    section = ""
    for number, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped[0] in "#;":
            continue
        section_match = re.match(r"\[([^\]]+)\]", stripped)
        if section_match:
            section = section_match.group(1).strip().lower()
            continue
        if "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip().lower()
        value = value.strip().strip("\"'")
        if section == "user" and key in {"name", "email", "signingkey"} and value:
            findings.append(Finding(rel, number, "git-identity"))
        if section.startswith("credential") and key == "helper" and value:
            lowered = value.lower()
            if lowered == "store" or lowered.startswith("store "):
                findings.append(Finding(rel, number, "credential-helper-store"))
    return findings


def jsonc_array_nonempty(text: str, start: int) -> bool:
    depth = 1
    has_value = False
    in_string = False
    escaped = False
    in_line_comment = False
    in_block_comment = False
    index = start
    while index < len(text):
        char = text[index]
        following = text[index + 1] if index + 1 < len(text) else ""
        if in_line_comment:
            if char == "\n":
                in_line_comment = False
            index += 1
            continue
        if in_block_comment:
            if char == "*" and following == "/":
                in_block_comment = False
                index += 2
            else:
                index += 1
            continue
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            index += 1
            continue
        if char == "/" and following == "/":
            in_line_comment = True
            index += 2
            continue
        if char == "/" and following == "*":
            in_block_comment = True
            index += 2
            continue
        if char == '"':
            in_string = True
            has_value = True
            index += 1
            continue
        if char == "[":
            depth += 1
            has_value = True
            index += 1
            continue
        if char == "]":
            depth -= 1
            if depth == 0:
                return has_value
            index += 1
            continue
        if not char.isspace():
            has_value = True
        index += 1
    return has_value


def scan_zed_settings(rel: str, text: str) -> list[Finding]:
    findings: list[Finding] = []
    for match in re.finditer(r'"ssh_connections"\s*:\s*\[', text):
        if jsonc_array_nonempty(text, match.end()):
            line = text.count("\n", 0, match.start()) + 1
            findings.append(Finding(rel, line, "zed-ssh-connections"))
    return findings


def scan_text(rel: str, text: str) -> list[Finding]:
    findings: list[Finding] = []
    for number, line in enumerate(text.splitlines(), 1):
        for rule, pattern in SECRET_RULES:
            if pattern.search(line):
                findings.append(Finding(rel, number, rule))
        for rule, pattern in ASSIGN_RULES:
            match = pattern.search(line)
            if match and plausible_secret(match.group(1)):
                findings.append(Finding(rel, number, rule))
        for match in NONPORTABLE_HOME.finditer(line):
            if match.group(1) not in HOME_PLACEHOLDERS:
                findings.append(Finding(rel, number, "nonportable-home"))
        for match in IPV4.finditer(line):
            try:
                address = ipaddress.ip_address(match.group(1))
            except ValueError:
                continue
            if any(address in network for network in PRIVATE_NETWORKS):
                findings.append(Finding(rel, number, "private-ip"))
        if rel.startswith("system/etc/") and UUID.search(line):
            findings.append(Finding(rel, number, "boot-uuid"))
    if rel == ".gitconfig":
        findings.extend(scan_gitconfig(rel, text))
    if rel.startswith(".config/zed/settings") and rel.endswith(".json"):
        findings.extend(scan_zed_settings(rel, text))
    return list(dict.fromkeys(findings))


def is_binary(data: bytes) -> bool:
    if b"\0" in data[:8192]:
        return True
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        return True
    return False


def png_allowed(rel: str, data: bytes) -> bool:
    return (
        rel.lower().endswith(".png")
        and rel.startswith(PNG_LOCATIONS)
        and data.startswith(PNG_MAGIC)
    )


def scan_bytes(rel: str, data: bytes) -> list[Finding]:
    if len(data) > MAX_FILE_BYTES:
        return [Finding(rel, None, "oversized-file")]
    if is_binary(data):
        if png_allowed(rel, data):
            return []
        return [Finding(rel, None, "binary-content")]
    return scan_text(rel, data.decode("utf-8", "replace"))


def symlink_ancestor(path: Path) -> bool:
    parts = path.parent.parts
    if not parts:
        return False
    current = Path(parts[0])
    for part in parts[1:]:
        current = current / part
        try:
            info = current.lstat()
        except OSError:
            continue
        if stat.S_ISLNK(info.st_mode):
            return True
    return False


def denied_source_path(path: Path) -> bool:
    if any(part in CREDENTIAL_DIRS for part in path.parts):
        return True
    if path.name in CREDENTIAL_BASENAMES:
        return True
    if denied_rule(path.name):
        return True
    posix = path.as_posix()
    return any(
        posix.endswith(tail)
        for tail in (".config/gh/hosts.yml", ".docker/config.json", ".kube/config")
    )


def worktree_symlink_findings(
    root: Path,
    rel: str,
    tracked: set[str],
    seen: set[str] | None = None,
) -> list[Finding]:
    seen = set() if seen is None else seen
    if rel in seen:
        return [Finding(rel, None, "symlink-cycle")]
    seen.add(rel)
    path = root / rel
    if symlink_ancestor(path):
        return [Finding(rel, None, "unsafe-symlink")]
    try:
        info = path.lstat()
    except OSError:
        return [Finding(rel, None, "unreadable-file")]
    if not stat.S_ISLNK(info.st_mode):
        return []
    try:
        target = os.readlink(path)
    except OSError:
        return [Finding(rel, None, "unreadable-file")]
    if os.path.isabs(target):
        return [Finding(rel, None, "unsafe-symlink")]
    target_rel = normalize_rel(posixpath.join(posixpath.dirname(rel), target))
    if target_rel == ".." or target_rel.startswith("../"):
        return [Finding(rel, None, "unsafe-symlink")]
    if denied_rule(target_rel):
        return [Finding(rel, None, "denied-path")]
    if target_rel not in tracked:
        return [Finding(rel, None, "untracked-symlink-target")]
    return worktree_symlink_findings(root, target_rel, tracked, seen)


def scan_worktree_file(root: Path, rel: str, tracked: set[str]) -> list[Finding]:
    denied = denied_rule(rel)
    if denied:
        return [Finding(rel, None, denied)]

    path = root / rel
    if symlink_ancestor(path):
        return [Finding(rel, None, "unsafe-symlink")]
    try:
        info = path.lstat()
    except OSError:
        return [Finding(rel, None, "unreadable-file")]

    if stat.S_ISLNK(info.st_mode):
        return worktree_symlink_findings(root, rel, tracked)

    if not stat.S_ISREG(info.st_mode):
        return [Finding(rel, None, "non-regular-file")]
    if info.st_size > MAX_FILE_BYTES:
        return [Finding(rel, None, "oversized-file")]
    try:
        return scan_bytes(rel, path.read_bytes())
    except OSError:
        return [Finding(rel, None, "unreadable-file")]


def scan_source_file(rel: str, source: str) -> list[Finding]:
    denied = denied_rule(rel)
    if denied:
        return [Finding(rel, None, denied)]

    path = Path(os.path.abspath(source))
    if denied_source_path(path):
        return [Finding(rel, None, "denied-path")]
    if symlink_ancestor(path):
        return [Finding(rel, None, "unsafe-source-symlink")]
    try:
        info = path.lstat()
    except OSError:
        return [Finding(rel, None, "unreadable-file")]
    if stat.S_ISLNK(info.st_mode):
        return [Finding(rel, None, "unsafe-source-symlink")]
    if not stat.S_ISREG(info.st_mode):
        return [Finding(rel, None, "non-regular-file")]
    if info.st_size > MAX_FILE_BYTES:
        return [Finding(rel, None, "oversized-file")]
    try:
        return scan_bytes(rel, path.read_bytes())
    except OSError:
        return [Finding(rel, None, "unreadable-file")]


def git_output(root: Path, *args: str) -> bytes:
    result = subprocess.run(
        ("git", "-C", str(root), *args),
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", "replace").strip()
        raise RuntimeError(message or "git command failed")
    return result.stdout


def tracked_paths(root: Path) -> list[str]:
    raw = git_output(root, "ls-files", "-z")
    return sorted(path for path in raw.decode("utf-8", "surrogateescape").split("\0") if path)


def scan_staged(root: Path) -> list[Finding]:
    raw = git_output(root, "ls-files", "-s", "-z")
    findings: list[Finding] = []
    index: dict[str, tuple[str, bytes]] = {}
    for record in raw.decode("utf-8", "surrogateescape").split("\0"):
        if not record:
            continue
        header, _, rel = record.partition("\t")
        fields = header.split()
        if len(fields) < 3:
            continue
        mode = fields[0]
        denied = denied_rule(rel)
        if denied:
            findings.append(Finding(rel, None, denied))
            continue
        if mode not in {"100644", "100755", "120000"}:
            findings.append(Finding(rel, None, "unsupported-index-mode"))
            continue
        try:
            size = int(git_output(root, "cat-file", "-s", f":{rel}").strip())
        except (RuntimeError, ValueError):
            findings.append(Finding(rel, None, "unreadable-file"))
            continue
        if size > MAX_FILE_BYTES:
            findings.append(Finding(rel, None, "oversized-file"))
            continue
        try:
            data = git_output(root, "show", f":{rel}")
        except RuntimeError:
            findings.append(Finding(rel, None, "unreadable-file"))
            continue
        index[rel] = (mode, data)

    for rel, (mode, data) in index.items():
        if mode == "120000":
            findings.extend(validate_staged_symlink(rel, index))
        else:
            findings.extend(scan_bytes(rel, data))
    return list(dict.fromkeys(findings))


def validate_staged_symlink(
    rel: str,
    index: dict[str, tuple[str, bytes]],
) -> list[Finding]:
    seen: set[str] = set()
    current = rel
    while True:
        if current in seen:
            return [Finding(rel, None, "symlink-cycle")]
        seen.add(current)
        entry = index.get(current)
        if entry is None:
            return [Finding(rel, None, "untracked-symlink-target")]
        mode, data = entry
        if mode != "120000":
            return []
        target = data.decode("utf-8", "replace")
        if os.path.isabs(target):
            return [Finding(rel, None, "unsafe-symlink")]
        target_rel = normalize_rel(posixpath.join(posixpath.dirname(current), target))
        if target_rel == ".." or target_rel.startswith("../"):
            return [Finding(rel, None, "unsafe-symlink")]
        if denied_rule(target_rel):
            return [Finding(rel, None, "denied-path")]
        if target_rel not in index:
            return [Finding(rel, None, "untracked-symlink-target")]
        current = target_rel


def report(findings: Iterable[Finding], quiet_success: bool = False) -> int:
    count = 0
    for finding in findings:
        location = finding.path
        if finding.line is not None:
            location = f"{location}:{finding.line}"
        print(f"privacy: {location}: {finding.rule}", file=sys.stderr)
        count += 1
    if count:
        print(f"privacy check: {count} finding(s)", file=sys.stderr)
        return 1
    if not quiet_success:
        print("privacy check: clean")
    return 0


def repo_root(explicit: str | None) -> Path:
    if explicit:
        return Path(explicit).resolve()
    result = subprocess.run(
        ("git", "rev-parse", "--show-toplevel"),
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        raise RuntimeError("not inside a git worktree; use --repo PATH")
    return Path(result.stdout.decode().strip()).resolve()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Check tracked files for credentials and nonportable data.",
    )
    parser.add_argument("--repo", help="repository root (default: current git worktree)")
    parser.add_argument("--staged", action="store_true", help="scan staged index content")
    parser.add_argument(
        "--file",
        nargs=2,
        metavar=("REL", "SOURCE"),
        help="validate one repository path and source file before capture",
    )
    parser.add_argument(
        "--denied",
        metavar="REL",
        help="exit 0 when REL is a denied path, 1 when allowed",
    )
    args = parser.parse_args(argv)

    if args.denied:
        rule = denied_rule(args.denied)
        if rule:
            print(rule)
            return 0
        return 1

    if args.file:
        rel, source = args.file
        rel = normalize_rel(rel)
        if rel.startswith("../") or rel == ".." or os.path.isabs(rel):
            print(f"privacy: {rel}: unsafe-path", file=sys.stderr)
            return 1
        return report(scan_source_file(rel, source), quiet_success=True)

    try:
        root = repo_root(args.repo)
        if args.staged:
            return report(scan_staged(root))
        findings: list[Finding] = []
        tracked = tracked_paths(root)
        tracked_set = set(tracked)
        for rel in tracked:
            findings.extend(scan_worktree_file(root, rel, tracked_set))
        return report(findings)
    except RuntimeError as error:
        print(f"privacy-check: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
