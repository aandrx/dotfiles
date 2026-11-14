#!/usr/bin/env python3
"""Waybar module: Claude Pro usage limits.

Reads the Anthropic OAuth usage endpoint used by Claude Code:

    GET https://api.anthropic.com/api/oauth/usage

The response's `limits` array provides:
    session      5-hour window
    weekly_all   weekly window
    weekly_scoped  model-scoped weekly window (Fable)

The widget shows used percentages, matching the Claude usage page. It reads
the read-only access token from ~/.pi/agent/auth.json and never writes
credentials. Set ANTHROPIC_OAUTH_TOKEN to override for testing.

Self-contained add-on. To uninstall:
  1. delete this file, claude-quota-click.sh, claude-quota.css
  2. remove the "custom/claude-quota" block and modules-right entries
  3. remove the @import "claude-quota.css" line in the profile styles
"""

from __future__ import annotations

import html
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
AUTH_PATH = Path.home() / ".pi" / "agent" / "auth.json"
USER_AGENT = "claude-cli/2.1.92 (external, cli)"
CACHE_TTL = 270
STALE_TTL = 3600
BACKOFF_TTL = 300
HTTP_TIMEOUT = 5
CACHE_NAME = "waybar-claude-quota.data"
VIEW_NAME = "waybar-claude-quota.view"
RETRY_NAME = "waybar-claude-quota.retry"


def debug(msg: str) -> None:
    if os.environ.get("CLAUDE_QUOTA_DEBUG") == "1":
        print(f"claude-quota: {msg}", file=sys.stderr)


def cache_dir() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base)


def now_epoch() -> float:
    override = os.environ.get("CLAUDE_QUOTA_NOW")
    if override:
        try:
            return float(override)
        except ValueError:
            pass
    return time.time()


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def read_json(path: Path):
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def write_atomic(path: Path, text: str) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)
    except OSError as exc:
        debug(f"cache write failed: {exc}")


def parse_time(value) -> float | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def load_token(now: float) -> str | None:
    override = os.environ.get("ANTHROPIC_OAUTH_TOKEN")
    if override and override.strip():
        return override.strip()
    data = read_json(AUTH_PATH)
    entry = data.get("anthropic") if isinstance(data, dict) else None
    if not isinstance(entry, dict):
        return None
    access = entry.get("access")
    expires = entry.get("expires")
    if not isinstance(access, str) or not access.strip():
        return None
    if isinstance(expires, (int, float)) and not isinstance(expires, bool):
        if expires / 1000 <= now + 60:
            return None
    return access.strip()


def clamp_percent(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return min(100.0, max(0.0, float(value)))


def normalize(payload) -> dict | None:
    if not isinstance(payload, dict):
        return None
    result: dict = {}
    limits = payload.get("limits")
    scoped_index = None

    if isinstance(limits, list):
        for index, item in enumerate(limits):
            if not isinstance(item, dict):
                continue
            percent = clamp_percent(item.get("percent"))
            if percent is None:
                continue
            entry = {
                "percent": percent,
                "reset": parse_time(item.get("resets_at")),
                "severity": item.get("severity") if isinstance(item.get("severity"), str) else "normal",
            }
            kind = item.get("kind")
            if kind == "session":
                result["session"] = entry
            elif kind == "weekly_all":
                result["weekly"] = entry
            elif kind == "weekly_scoped":
                scope = item.get("scope")
                model = scope.get("model") if isinstance(scope, dict) else None
                name = model.get("display_name") if isinstance(model, dict) else None
                if isinstance(name, str) and name and "fable" not in result:
                    entry["name"] = name
                    result["fable"] = entry
                    scoped_index = index

    if scoped_index is not None:
        shares = payload.get("weekly_scoped_shares")
        if isinstance(shares, list):
            for share in shares:
                if not isinstance(share, dict) or share.get("limit_index") != scoped_index:
                    continue
                allowance = share.get("allowance_percent_of_weekly")
                if isinstance(allowance, (int, float)) and not isinstance(allowance, bool):
                    result["fable_allowance"] = float(allowance)
                    break

    # Older responses may only have the top-level fields.
    if "session" not in result:
        five = payload.get("five_hour")
        utilization = five.get("utilization") if isinstance(five, dict) else None
        percent = clamp_percent(utilization * 100) if isinstance(utilization, (int, float)) and not isinstance(utilization, bool) else None
        if percent is not None:
            result["session"] = {
                "percent": percent,
                "reset": parse_time(five.get("resets_at")),
                "severity": "normal",
            }
    if "weekly" not in result:
        week = payload.get("seven_day")
        utilization = week.get("utilization") if isinstance(week, dict) else None
        percent = clamp_percent(utilization * 100) if isinstance(utilization, (int, float)) and not isinstance(utilization, bool) else None
        if percent is not None:
            result["weekly"] = {
                "percent": percent,
                "reset": parse_time(week.get("resets_at")),
                "severity": "normal",
            }

    return result if result else None


def fetch_usage(token: str) -> dict:
    request = urllib.request.Request(
        USAGE_URL,
        headers={
            "Authorization": f"Bearer {token}",
            "anthropic-beta": "oauth-2025-04-20",
            "anthropic-version": "2023-06-01",
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
        payload = json.loads(response.read(65536))
    data = normalize(payload)
    if data is None:
        raise ValueError("usage response did not match the expected shape")
    return data


def load_cache(now: float) -> dict | None:
    data = read_json(cache_dir() / CACHE_NAME)
    if not isinstance(data, dict):
        return None
    at = data.get("at")
    if isinstance(at, bool) or not isinstance(at, (int, float)):
        return None
    if now - at > STALE_TTL:
        return None
    for key in ("session", "weekly", "fable"):
        entry = data.get(key)
        if entry is None:
            continue
        if not isinstance(entry, dict):
            return None
        percent = entry.get("percent")
        reset = entry.get("reset")
        severity = entry.get("severity", "normal")
        if (
            isinstance(percent, bool)
            or not isinstance(percent, (int, float))
            or not 0 <= percent <= 100
            or (reset is not None and (isinstance(reset, bool) or not isinstance(reset, (int, float))))
            or not isinstance(severity, str)
        ):
            return None
    if not any(data.get(k) for k in ("session", "weekly", "fable")):
        return None
    return data


def save_cache(data: dict, now: float) -> None:
    payload = {"at": now}
    payload.update(data)
    write_atomic(cache_dir() / CACHE_NAME, json.dumps(payload, separators=(",", ":")))


def read_epoch(name: str) -> float | None:
    text = read_text(cache_dir() / name)
    try:
        return float(text)
    except ValueError:
        return None


def write_epoch(name: str, value: float) -> None:
    write_atomic(cache_dir() / name, str(value))


def clear_epoch(name: str) -> None:
    try:
        (cache_dir() / name).unlink()
    except OSError:
        pass


def view() -> str:
    return read_text(cache_dir() / VIEW_NAME) or "compact"


def percent_text(entry: dict) -> str:
    if entry["percent"] >= 100:
        return "MAX"
    return f"{round(entry['percent']):g}%"


def bar(percent: float) -> str:
    filled = int(round(max(0.0, min(100.0, percent)) / 10))
    if percent > 0 and filled == 0:
        filled = 1
    return "█" * filled + "░" * (10 - filled)


def fmt_duration(seconds: float) -> str:
    seconds = max(0, int(seconds))
    if seconds < 60:
        return "<1m"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes}m"
    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return f"{hours}h {minutes:02d}m"
    days, hours = divmod(hours, 24)
    if days < 10:
        return f"{days}d {hours:02d}h"
    return f"{days}d"


def reset_text(entry: dict, now: float) -> str:
    reset = entry.get("reset")
    if reset is None:
        return "not active"
    if reset <= now:
        return "resetting now"
    return f"resets in {fmt_duration(reset - now)}"


def state_class(data: dict) -> str:
    entries = [e for e in (data.get("session"), data.get("weekly"), data.get("fable")) if e]
    if any(e["percent"] >= 100 for e in entries):
        return "max"
    severities = {e.get("severity", "normal") for e in entries}
    if severities & {"critical", "exceeded"}:
        return "crit"
    if severities & {"warning", "warn"}:
        return "warn"
    worst = max(e["percent"] for e in entries)
    if worst >= 90:
        return "crit"
    if worst >= 75:
        return "warn"
    return "ok"


def render(
    data: dict,
    now: float,
    *,
    stale: bool = False,
    error: str | None = None,
) -> dict:
    session = data.get("session")
    weekly = data.get("weekly")
    fable = data.get("fable")
    primary_key = "session" if session else "weekly" if weekly else "fable"
    primary = data[primary_key]

    if view() == "expanded":
        parts = []
        for key, label in (("session", "5h"), ("weekly", "W"), ("fable", "F")):
            if data.get(key):
                parts.append(f"{label} {percent_text(data[key])}")
        text = "CC " + "  ".join(parts)
    else:
        label = {"session": "5h", "weekly": "W", "fable": "F"}[primary_key]
        text = f"CC {label} {percent_text(primary)}"
    if stale:
        text = text.replace("CC ", "CC ~ ", 1)

    if primary_key == "session":
        state = f"{percent_text(primary)} of 5h window used"
    elif primary_key == "weekly":
        state = f"{percent_text(primary)} of weekly limit used"
    else:
        state = f"{percent_text(primary)} of {fable.get('name', 'Fable')} limit used"
    if primary["percent"] >= 100:
        state = "rate limited"

    lines = [f"<b>Claude</b> - {state}"]
    for key, label in (("session", "5h"), ("weekly", "week"), ("fable", fable.get("name", "Fable") if fable else "Fable")):
        entry = data.get(key)
        if not entry:
            continue
        used = "MAX" if entry["percent"] >= 100 else f"{percent_text(entry)} used"
        lines.append(
            "<tt>{label:<5} {bar}  {used:<8} {reset}</tt>".format(
                label=label,
                bar=bar(entry["percent"]),
                used=used,
                reset=reset_text(entry, now),
            )
        )

    allowance = data.get("fable_allowance")
    if fable and isinstance(allowance, (int, float)):
        lines.append("")
        lines.append(f"<tt>{fable.get('name', 'Fable')}: scoped weekly, {allowance:g}% of weekly</tt>")

    if stale:
        lines.append("<tt>Last good data shown - refresh failed</tt>")
    if error:
        lines.append(f"<tt>{html.escape(error)}</tt>")
    lines.append("<tt>LC expand - RC refresh - MC console</tt>")

    return {
        "text": text,
        "alt": text,
        "class": "stale" if stale else state_class(data),
        "tooltip": "\n".join(lines),
    }


def unavailable(message: str, *, auth: bool = False) -> dict:
    label = "CC auth" if auth else "CC N/A"
    return {
        "text": label,
        "alt": label,
        "class": "unavailable",
        "tooltip": f"<b>Claude</b> - unavailable\n<tt>{html.escape(message)}</tt>",
    }


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    now = now_epoch()
    fixture = os.environ.get("CLAUDE_QUOTA_FIXTURE")
    if fixture:
        payload = read_json(Path(fixture))
        data = normalize(payload)
        if data is None:
            print(json.dumps(unavailable("fixture did not match the expected shape")))
            return 0
        print(json.dumps(render(data, now), ensure_ascii=False))
        return 0

    token = load_token(now)
    cache = load_cache(now)
    if not token:
        print(json.dumps(unavailable(
            "Anthropic OAuth token is missing or expired. Reconnect Anthropic in pi.",
            auth=True,
        )))
        return 0
    if cache is not None and now - cache["at"] < CACHE_TTL:
        print(json.dumps(render(cache, now), ensure_ascii=False))
        return 0

    retry_at = read_epoch(RETRY_NAME)
    if retry_at is not None and now - retry_at < BACKOFF_TTL:
        if cache is not None:
            print(json.dumps(
                render(cache, now, stale=True, error="Rate limited; backing off before retrying"),
                ensure_ascii=False,
            ))
        else:
            print(json.dumps(unavailable(
                "Anthropic usage endpoint is rate limited; backing off before retrying."
            )))
        return 0

    try:
        data = fetch_usage(token)
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            print(json.dumps(unavailable(
                f"HTTP {exc.code}: Anthropic OAuth token rejected. Reconnect Anthropic in pi.",
                auth=True,
            )))
            return 0
        if exc.code == 429:
            write_epoch(RETRY_NAME, now)
            message = "HTTP 429: Anthropic usage endpoint rate limited; backing off"
        else:
            message = f"HTTP {exc.code} from Anthropic usage endpoint"
        if cache is not None and now - cache["at"] <= STALE_TTL:
            print(json.dumps(render(cache, now, stale=True, error=message), ensure_ascii=False))
            return 0
        print(json.dumps(unavailable(message)))
        return 0
    except Exception as exc:
        message = f"fetch failed: {exc}"[:200]
        debug(message)
        if cache is not None and now - cache["at"] <= STALE_TTL:
            print(json.dumps(render(cache, now, stale=True, error=message), ensure_ascii=False))
            return 0
        print(json.dumps(unavailable(message)))
        return 0

    clear_epoch(RETRY_NAME)
    save_cache(data, now)
    print(json.dumps(render(data, now), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
