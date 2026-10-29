#!/usr/bin/env python3
"""Waybar module: OpenCode Go subscription usage.

Emits one JSON line for Waybar:
    {"text": ..., "alt": ..., "class": ..., "tooltip": ...}

Data source (verified):
    GET https://opencode.ai/zen/go/v1/usage
    Authorization: Bearer <key>
    User-Agent: <non-generic>

The endpoint returns three allowance windows:
    rolling  5-hour window, resets 5h after last usage
    weekly   resets Monday 00:00 UTC
    monthly  resets on the subscription anniversary (UTC)

`percent` is *used* percent (integer floor). Set OPENCODE_GO_METRIC=remaining
to display quota left instead, matching the Codex module's convention.

The hover also includes a cached 30-day OpenCode Go cost, request, and token
summary from the console usage endpoint. It uses the same Go API key and is
omitted if that optional endpoint is unavailable.

Self-contained add-on. To uninstall:
  1. delete this file, opencode-go-click.sh, opencode-go.css
  2. remove the "custom/opencode-go" block and the modules-right entry
     in config.jsonc
  3. remove the @import "opencode-go.css" line in style.css
"""

from __future__ import annotations

import html
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ENDPOINT = "https://opencode.ai/zen/go/v1/usage"
USER_AGENT = "opencode-waybar/1.0"
CONFIG_DIR = Path.home() / ".config" / "waybar-niri"
KEY_FILE = CONFIG_DIR / "opencode-go.key"
PI_AUTH = Path.home() / ".pi" / "agent" / "auth.json"
OPENCODE_DB = Path.home() / ".local" / "share" / "opencode" / "opencode.db"

CACHE_TTL = 55          # seconds before a fresh HTTP request
STALE_TTL = 900         # seconds to keep showing the last good response on network failure
HTTP_TIMEOUT = 5        # seconds
SUMMARY_URL = "https://opencode.ai/console/api/usage/models?range=30d&pageSize=100"
SUMMARY_TTL = 300        # seconds between console cost/requests/tokens fetches
SUMMARY_STALE_TTL = 3600 # seconds to keep showing a stale summary on failure
MICRO_CENTS_PER_DOLLAR = 100_000_000
WINDOWS = ("rolling", "weekly", "monthly")
WINDOW_LABEL = {"rolling": "5h", "weekly": "W", "monthly": "M"}
WINDOW_FULL = {"rolling": "5h", "weekly": "week", "monthly": "month"}


def debug(msg: str) -> None:
    if os.environ.get("OPENCODE_GO_DEBUG") == "1":
        print(f"opencode-go: {msg}", file=sys.stderr)


def cache_dir() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base)


def now_epoch() -> float:
    override = os.environ.get("OPENCODE_GO_NOW")
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


def key_from_pi_auth() -> str | None:
    data = read_json(PI_AUTH)
    if not isinstance(data, dict):
        return None
    entry = data.get("opencode-go")
    if not isinstance(entry, dict):
        return None
    key = entry.get("key")
    if isinstance(key, str) and key.strip():
        return key.strip()
    return None


def key_from_opencode_db(now: float) -> str | None:
    """Last-resort fallback: the stored console OAuth access token.

    The access token expires; opencode refreshes it on use. Never print it.
    """
    if not OPENCODE_DB.exists():
        return None
    try:
        uri = f"file:{OPENCODE_DB}?mode=ro"
        with sqlite3.connect(uri, uri=True, timeout=2) as conn:
            row = conn.execute(
                "select value from credential where active = 1 "
                "and (integration_id = 'opencode' or integration_id is null) "
                "order by time_updated desc limit 1"
            ).fetchone()
    except sqlite3.Error as exc:
        debug(f"opencode db read failed: {exc}")
        return None
    if not row or not isinstance(row[0], str):
        return None
    try:
        data = json.loads(row[0])
    except ValueError:
        return None
    access = data.get("access")
    expires = data.get("expires")
    if not isinstance(access, str) or not access.strip():
        return None
    if isinstance(expires, (int, float)) and not isinstance(expires, bool):
        # expires is milliseconds since epoch
        if expires / 1000 <= now + 60:
            debug("opencode db access token is expired")
            return None
    return access.strip()


def find_key(now: float) -> tuple[str | None, str | None]:
    for name in ("OPENCODE_GO_KEY", "OPENCODE_GO_API_KEY"):
        value = os.environ.get(name)
        if value and value.strip():
            return value.strip(), name
    value = read_text(KEY_FILE)
    if value:
        return value, str(KEY_FILE)
    value = key_from_pi_auth()
    if value:
        return value, "~/.pi/agent/auth.json"
    value = key_from_opencode_db(now)
    if value:
        return value, "opencode database"
    return None, None


def parse_reset(value) -> float | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def normalize(payload) -> dict | None:
    """Validate and normalize the usage endpoint payload."""
    if not isinstance(payload, dict):
        return None
    usage = payload.get("usage")
    if not isinstance(usage, dict):
        return None

    windows: dict[str, dict] = {}
    for name in WINDOWS:
        raw = usage.get(name)
        if raw is None:
            continue
        if not isinstance(raw, dict):
            return None
        percent = raw.get("percent")
        if isinstance(percent, bool) or not isinstance(percent, (int, float)):
            return None
        if not 0 <= percent <= 100:
            return None
        reset = parse_reset(raw.get("resetsAt"))
        if reset is None:
            return None
        status = raw.get("status")
        if not isinstance(status, str) or not status:
            status = "ok"
        windows[name] = {
            "status": status,
            "percent": float(percent),
            "resets_at": reset,
        }

    if not windows:
        return None
    return {"windows": windows}


def fetch_usage(key: str) -> dict:
    request = urllib.request.Request(
        ENDPOINT,
        headers={
            "Authorization": f"Bearer {key}",
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
        raw = response.read(65536)
    try:
        payload = json.loads(raw)
    except ValueError as exc:
        raise ValueError("usage response was not JSON") from exc
    normalized = normalize(payload)
    if normalized is None:
        raise ValueError("usage response did not match the expected shape")
    return normalized


def as_int(value) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return 0
    return 0


def fetch_summary(key: str, now: float) -> dict:
    request = urllib.request.Request(
        SUMMARY_URL,
        headers={
            "Authorization": f"Bearer {key}",
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
        payload = json.loads(response.read(262144))
    items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        raise ValueError("usage summary did not match the expected shape")

    requests = 0
    tokens = 0
    cost = 0
    for item in items:
        if not isinstance(item, dict) or item.get("provider") != "opencode-go":
            continue
        requests += as_int(item.get("totalRequests"))
        for field in (
            "totalInputTokens",
            "totalOutputTokens",
            "totalCacheReadTokens",
            "totalCacheWrite5mTokens",
            "totalCacheWrite1hTokens",
        ):
            tokens += as_int(item.get(field))
        cost += as_int(item.get("totalCostMicroCents"))
    return {"at": now, "requests": requests, "tokens": tokens, "cost_micro_cents": cost}


def load_summary(now: float) -> dict | None:
    data = read_json(cache_dir() / "waybar-opencode-go.summary")
    if not isinstance(data, dict):
        return None
    at = data.get("at")
    if isinstance(at, bool) or not isinstance(at, (int, float)):
        return None
    if now - at > SUMMARY_STALE_TTL:
        return None
    for name in ("requests", "tokens", "cost_micro_cents"):
        value = data.get(name)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
    return {
        "at": float(at),
        "requests": int(data["requests"]),
        "tokens": int(data["tokens"]),
        "cost_micro_cents": int(data["cost_micro_cents"]),
    }


def save_summary(data: dict) -> None:
    write_atomic(
        cache_dir() / "waybar-opencode-go.summary",
        json.dumps(data, separators=(",", ":")),
    )


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


def get_summary(key: str | None, now: float) -> dict | None:
    if not key:
        return None
    cached = load_summary(now)
    if cached is not None and now - cached["at"] < SUMMARY_TTL:
        return cached
    retry = "waybar-opencode-go.summary.retry"
    retry_at = read_epoch(retry)
    if retry_at is not None and now - retry_at < SUMMARY_TTL:
        return cached
    try:
        data = fetch_summary(key, now)
    except Exception as exc:
        debug(f"summary fetch failed: {exc}")
        write_epoch(retry, now)
        return cached
    save_summary(data)
    clear_epoch(retry)
    return data


def fmt_cost(micro_cents: int) -> str:
    dollars = micro_cents / MICRO_CENTS_PER_DOLLAR
    if 0 < dollars < 0.01:
        return "<$0.01"
    return f"${dollars:,.2f}"


def fmt_tokens(tokens: int) -> str:
    if tokens >= 1_000_000_000:
        return f"{tokens / 1_000_000_000:.1f}B"
    if tokens >= 1_000_000:
        return f"{tokens / 1_000_000:.1f}M"
    if tokens >= 1_000:
        return f"{tokens / 1_000:.1f}K"
    return str(tokens)


def http_error_message(exc: urllib.error.HTTPError) -> str:
    detail = ""
    try:
        body = exc.read(512).decode("utf-8", "replace")
        try:
            parsed = json.loads(body)
            if isinstance(parsed, dict):
                err = parsed.get("error")
                if isinstance(err, dict):
                    detail = str(err.get("message") or err.get("type") or "")
                elif isinstance(err, str):
                    detail = err
        except ValueError:
            detail = body.strip()
    except Exception:
        pass
    detail = " ".join(detail.split())[:160]
    if exc.code == 401:
        hint = "invalid or expired key"
    elif exc.code == 403:
        hint = "no Go subscription, or the request was blocked"
    elif exc.code == 404:
        hint = "usage endpoint not available"
    elif exc.code == 429:
        hint = "rate limited"
    else:
        hint = "request failed"
    return f"HTTP {exc.code}: {hint}" + (f" ({detail})" if detail else "")


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


def fmt_reset(reset: float, now: float) -> str:
    if reset <= now:
        return "resetting now"
    return f"resets in {fmt_duration(reset - now)}"


def bar(percent: float) -> str:
    filled = int(round(max(0.0, min(100.0, percent)) / 10))
    if percent > 0 and filled == 0:
        filled = 1
    return "█" * filled + "░" * (10 - filled)


def effective_used(window: dict, now: float) -> float:
    if window["resets_at"] <= now:
        return 0.0
    return window["percent"]


def is_max(window: dict, now: float) -> bool:
    return window["resets_at"] > now and (
        window["status"] == "rate-limited" or window["percent"] >= 100
    )


def display_value(window: dict, now: float, metric: str) -> str:
    if is_max(window, now):
        return "MAX"
    used = effective_used(window, now)
    value = 100 - used if metric == "remaining" else used
    return f"{round(value):g}%"


def state_class(windows: dict, now: float) -> str:
    if any(is_max(w, now) for w in windows.values()):
        return "max"
    worst = max(effective_used(w, now) for w in windows.values())
    if worst >= 90:
        return "crit"
    if worst >= 75:
        return "warn"
    return "ok"


def class_for(windows: dict, now: float, stale: bool) -> str:
    if stale:
        return "stale"
    return state_class(windows, now)


def view() -> str:
    return read_text(cache_dir() / "waybar-opencode-go.view") or "compact"


def render(
    windows: dict,
    now: float,
    *,
    stale: bool = False,
    error: str | None = None,
    last_success: float | None = None,
    summary: dict | None = None,
) -> dict:
    metric = os.environ.get("OPENCODE_GO_METRIC", "used").strip().lower()
    if metric not in ("used", "remaining"):
        metric = "used"

    rolling_name = "rolling" if "rolling" in windows else next(iter(windows))
    rolling = windows[rolling_name]
    if view() == "expanded":
        parts = [f"{WINDOW_LABEL[name]} {display_value(w, now, metric)}"
                 for name, w in windows.items()]
        text = "OCG " + "  ".join(parts)
    else:
        text = f"OCG {WINDOW_LABEL[rolling_name]} {display_value(rolling, now, metric)}"
    if stale:
        text = text.replace("OCG ", "OCG ~ ", 1)

    rolling_used = effective_used(rolling, now)
    if is_max(rolling, now):
        header_state = "rate limited"
    elif metric == "remaining":
        header_state = f"{round(100 - rolling_used):g}% of 5h window left"
    else:
        header_state = f"{round(rolling_used):g}% of 5h window used"

    lines = [f"<b>OpenCode Go</b> - {header_state}"]
    for name, w in windows.items():
        used = effective_used(w, now)
        if is_max(w, now):
            used_txt = "MAX"
        else:
            used_txt = f"{round(used):g}% used"
        lines.append(
            "<tt>{label:<5} {bar}  {used:<8} {reset}</tt>".format(
                label=WINDOW_FULL[name],
                bar=bar(used),
                used=used_txt,
                reset=html.escape(fmt_reset(w["resets_at"], now)),
            )
        )

    lines.append("")
    if summary is not None:
        lines.append(
            "<tt>30d  C {cost}  R {requests:,}  T {tokens}</tt>".format(
                cost=fmt_cost(summary["cost_micro_cents"]),
                requests=summary["requests"],
                tokens=fmt_tokens(summary["tokens"]),
            )
        )
    lines.append("<tt>Caps: 5h = 20%, week = 50%, month = 100%</tt>")

    if stale and last_success is not None:
        age = max(0, now - last_success)
        updated = datetime.fromtimestamp(last_success).astimezone().strftime("%H:%M:%S")
        lines.append(
            f"<tt>Last good {updated} ({fmt_duration(age)} ago) - refresh failed</tt>"
        )

    if error:
        lines.append(f"<tt>{html.escape(error)}</tt>")

    lines.append("<tt>LC expand - RC refresh - MC console</tt>")

    return {
        "text": text,
        "alt": text,
        "class": class_for(windows, now, stale),
        "tooltip": "\n".join(lines),
    }


def unavailable(message: str) -> dict:
    return {
        "text": "OCG N/A",
        "alt": "OCG N/A",
        "class": "unavailable",
        "tooltip": (
            "<b>OpenCode Go</b> - unavailable\n"
            f"<tt>{html.escape(message)}</tt>\n"
            "<tt>Set OPENCODE_GO_KEY or create "
            "~/.config/waybar-niri/opencode-go.key</tt>"
        ),
    }


def auth_required(message: str) -> dict:
    return {
        "text": "OCG auth",
        "alt": "OCG auth",
        "class": "unavailable",
        "tooltip": (
            "<b>OpenCode Go</b> - authentication failed\n"
            f"<tt>{html.escape(message)}</tt>\n"
            "<tt>Update OPENCODE_GO_KEY or the key file, then right click to retry.</tt>"
        ),
    }


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    now = now_epoch()
    cdir = cache_dir()
    cache_path = cdir / "waybar-opencode-go.data"

    fixture = os.environ.get("OPENCODE_GO_FIXTURE")
    if fixture:
        payload = read_json(Path(fixture))
        normalized = normalize(payload)
        if normalized is None:
            print(json.dumps(unavailable("fixture did not match the expected shape")))
            return 0
        print(json.dumps(render(normalized["windows"], now), ensure_ascii=False))
        return 0

    cache = read_json(cache_path)
    cache_valid = False
    if isinstance(cache, dict):
        fetched_at = cache.get("fetched_at")
        last_success = cache.get("last_success")
        raw_windows = cache.get("windows")
        if (
            isinstance(fetched_at, (int, float))
            and not isinstance(fetched_at, bool)
            and isinstance(last_success, (int, float))
            and not isinstance(last_success, bool)
            and isinstance(raw_windows, dict)
        ):
            windows: dict[str, dict] = {}
            for name in WINDOWS:
                raw = raw_windows.get(name)
                if not isinstance(raw, dict):
                    continue
                percent = raw.get("percent")
                reset = raw.get("resets_at")
                status = raw.get("status", "ok")
                if (
                    isinstance(percent, bool)
                    or not isinstance(percent, (int, float))
                    or not 0 <= percent <= 100
                    or isinstance(reset, bool)
                    or not isinstance(reset, (int, float))
                    or not isinstance(status, str)
                    or not status
                ):
                    continue
                windows[name] = {
                    "status": status,
                    "percent": float(percent),
                    "resets_at": float(reset),
                }
            if windows:
                cache = {
                    "fetched_at": float(fetched_at),
                    "last_success": float(last_success),
                    "windows": windows,
                }
                cache_valid = True

    key, source = find_key(now)
    summary = get_summary(key, now)

    if cache_valid and now - cache["fetched_at"] < CACHE_TTL and not os.environ.get("OPENCODE_GO_NO_CACHE"):
        print(json.dumps(
            render(
                cache["windows"],
                now,
                last_success=cache["last_success"],
                summary=summary,
            ),
            ensure_ascii=False,
        ))
        return 0

    if not key:
        print(json.dumps(unavailable(
            "No OpenCode Go key found."
        )))
        return 0

    debug(f"key source: {source}")
    try:
        normalized = fetch_usage(key)
    except urllib.error.HTTPError as exc:
        message = http_error_message(exc)
        debug(message)
        if exc.code == 401:
            print(json.dumps(auth_required(message)))
            return 0
        if exc.code in (403, 404):
            print(json.dumps(unavailable(message)))
            return 0
        if cache_valid and now - cache["last_success"] <= STALE_TTL:
            print(json.dumps(
                render(
                    cache["windows"],
                    now,
                    stale=True,
                    error=message,
                    last_success=cache["last_success"],
                    summary=summary,
                ),
                ensure_ascii=False,
            ))
            return 0
        print(json.dumps(unavailable(message)))
        return 0
    except Exception as exc:
        message = f"fetch failed: {exc}"[:200]
        debug(message)
        if cache_valid and now - cache["last_success"] <= STALE_TTL:
            print(json.dumps(
                render(
                    cache["windows"],
                    now,
                    stale=True,
                    error=message,
                    last_success=cache["last_success"],
                    summary=summary,
                ),
                ensure_ascii=False,
            ))
            return 0
        print(json.dumps(unavailable(message)))
        return 0

    write_atomic(cache_path, json.dumps({
        "fetched_at": now,
        "last_success": now,
        "windows": normalized["windows"],
    }))
    print(json.dumps(
        render(normalized["windows"], now, last_success=now, summary=summary),
        ensure_ascii=False,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
