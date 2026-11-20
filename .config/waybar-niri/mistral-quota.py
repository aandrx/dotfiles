#!/usr/bin/env python3
"""Waybar module: Mistral Education allowances.

Reads Mistral's billing endpoint with the Mistral API key stored by pi:

    GET https://api.mistral.ai/v1/billing/budget

The response contains `vibe_budget` and `api_budget` with a usage percentage,
initial budget, currency and reset timestamp. This avoids the browser session
entirely; the admin subscription page is no longer used.

Self-contained add-on. To uninstall:
  1. delete this file, mistral-quota-click.sh, mistral-quota.css
  2. remove the "custom/mistral-quota" block and modules-right entries
  3. remove the @import "mistral-quota.css" line in the profile styles
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

BILLING_URL = "https://api.mistral.ai/v1/billing/budget"
AUTH_PATH = Path.home() / ".pi" / "agent" / "auth.json"
USER_AGENT = "mistral-waybar/1.0"
CACHE_TTL = 270
STALE_TTL = 3600
BACKOFF_TTL = 300
HTTP_TIMEOUT = 8
CACHE_NAME = "waybar-mistral-quota.data"
VIEW_NAME = "waybar-mistral-quota.view"
RETRY_NAME = "waybar-mistral-quota.retry"


def debug(msg: str) -> None:
    if os.environ.get("MISTRAL_QUOTA_DEBUG") == "1":
        print(f"mistral-quota: {msg}", file=sys.stderr)


def cache_dir() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base)


def now_epoch() -> float:
    override = os.environ.get("MISTRAL_QUOTA_NOW")
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


def load_key() -> str | None:
    override = os.environ.get("MISTRAL_API_KEY")
    if override and override.strip():
        return override.strip()
    data = read_json(AUTH_PATH)
    entry = data.get("mistral") if isinstance(data, dict) else None
    if not isinstance(entry, dict):
        return None
    for field in ("key", "access"):
        value = entry.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def clamp_percent(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return min(100.0, max(0.0, float(value)))


def normalize_entry(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    total = raw.get("initial_budget")
    percent = clamp_percent(raw.get("usage_percentage"))
    if isinstance(total, bool) or not isinstance(total, (int, float)) or total <= 0:
        return None
    if percent is None:
        return None
    return {
        "percent": percent,
        "total": float(total),
        "used": float(total) * percent / 100.0,
        "reset": parse_time(raw.get("reset_at")),
    }


def normalize(payload) -> dict | None:
    if not isinstance(payload, dict):
        return None
    vibe = normalize_entry(payload.get("vibe_budget"))
    api = normalize_entry(payload.get("api_budget"))
    api_raw = payload.get("api_budget")
    api_unprovisioned = (
        isinstance(api_raw, dict)
        and isinstance(api_raw.get("initial_budget"), (int, float))
        and not isinstance(api_raw.get("initial_budget"), bool)
        and api_raw.get("initial_budget") <= 0
    )
    if vibe is None and api is None:
        return None
    result = {}
    if vibe is not None:
        result["vibe"] = vibe
    if api is not None:
        result["api"] = api
    if api_unprovisioned:
        result["api_unprovisioned"] = True
    return result


def fetch_budget(key: str) -> dict:
    request = urllib.request.Request(
        BILLING_URL,
        headers={
            "Authorization": f"Bearer {key}",
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
        payload = json.loads(response.read(65536))
    data = normalize(payload)
    if data is None:
        raise ValueError("billing response did not match the expected shape")
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
    for name in ("vibe", "api"):
        entry = data.get(name)
        if entry is None:
            continue
        if not isinstance(entry, dict):
            return None
        for field in ("percent", "total", "used"):
            value = entry.get(field)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                return None
        reset = entry.get("reset")
        if reset is not None and (isinstance(reset, bool) or not isinstance(reset, (int, float))):
            return None
    if not data.get("vibe") and not data.get("api"):
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


def money(value: float) -> str:
    if value == int(value):
        return f"${value:,.0f}"
    return f"${value:,.2f}"


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
    return f"{days}d {hours:02d}h"


def reset_text(entry: dict, now: float) -> str:
    reset = entry.get("reset")
    if reset is None:
        return ""
    if reset <= now:
        return "resetting now"
    return f"resets in {fmt_duration(reset - now)}"


def state_class(data: dict) -> str:
    entries = [e for e in (data.get("vibe"), data.get("api")) if e]
    if any(e["percent"] >= 100 for e in entries):
        return "max"
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
    vibe = data.get("vibe")
    api = data.get("api")
    primary_key = "vibe" if vibe else "api"
    primary = data[primary_key]

    if view() == "expanded":
        parts = []
        if vibe:
            parts.append(f"V {percent_text(vibe)}")
        if api:
            parts.append(f"A {percent_text(api)}")
        text = "MIS " + "  ".join(parts)
    else:
        text = f"MIS {'V' if vibe else 'A'} {percent_text(primary)}"
    if stale:
        text = text.replace("MIS ", "MIS ~ ", 1)

    if primary["percent"] >= 100:
        state = "rate limited"
    else:
        state = f"{percent_text(primary)} {'Vibe' if vibe else 'API'} used"

    lines = [f"<b>Mistral Education</b> - {state}"]
    for label, entry in (("Vibe", vibe), ("API", api)):
        if not entry:
            continue
        amount = f"{money(entry['used'])} / {money(entry['total'])}"
        used = "MAX" if entry["percent"] >= 100 else f"{percent_text(entry)} used"
        lines.append(
            "<tt>{label:<5} {bar}  {used:<9}  {amount:<15} {reset}</tt>".format(
                label=label,
                bar=bar(entry["percent"]),
                used=used,
                amount=amount,
                reset=reset_text(entry, now),
            )
        )
    if data.get("api_unprovisioned"):
        lines.append("<tt>API budget not provisioned on this account</tt>")

    lines.append("")
    caps = ["Vibe $150"] if vibe else []
    if api:
        caps.append(f"API ${api['total']:g}")
    if caps:
        lines.append("<tt>Caps: " + ", ".join(caps) + " per calendar month</tt>")
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
    label = "MIS auth" if auth else "MIS N/A"
    return {
        "text": label,
        "alt": label,
        "class": "unavailable",
        "tooltip": f"<b>Mistral Education</b> - unavailable\n<tt>{html.escape(message)}</tt>",
    }


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    now = now_epoch()
    fixture = os.environ.get("MISTRAL_QUOTA_FIXTURE")
    if fixture:
        payload = read_json(Path(fixture))
        data = normalize(payload)
        if data is None:
            print(json.dumps(unavailable("fixture did not match the expected shape")))
            return 0
        print(json.dumps(render(data, now), ensure_ascii=False))
        return 0

    key = load_key()
    if not key:
        print(json.dumps(unavailable(
            "No Mistral API key found. Connect Mistral in pi or set MISTRAL_API_KEY.",
            auth=True,
        )))
        return 0

    cache = load_cache(now)
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
            print(json.dumps(unavailable("Mistral billing endpoint is rate limited; backing off.")))
        return 0

    try:
        data = fetch_budget(key)
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            print(json.dumps(unavailable(
                f"HTTP {exc.code}: Mistral API key rejected. Reconnect Mistral in pi.",
                auth=True,
            )))
            return 0
        if exc.code == 429:
            write_epoch(RETRY_NAME, now)
            message = "HTTP 429: Mistral billing endpoint rate limited; backing off"
        else:
            message = f"HTTP {exc.code} from Mistral billing endpoint"
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
