#!/usr/bin/env python3
"""Waybar module: Mistral subscription allowances.

Mistral exposes no usage API below Enterprise, so this reads the same admin
subscription page the pi api-usage extension uses:

    https://admin.mistral.ai/subscription

Authentication is the browser session stored in Firefox cookies
(ory_session* and csrf_token* for .mistral.ai). Set MISTRAL_COOKIE to a full
Cookie header when Firefox is not the browser.

The page contains two allowances:
    Included API usage        $used $total
    Included Vibe Code usage  $used $total

Both reset on the first day of each calendar month. The widget shows Vibe in
compact mode and both budgets in the expanded view and tooltip.

Self-contained add-on. To uninstall:
  1. delete this file, mistral-quota-click.sh, mistral-quota.css
  2. remove the "custom/mistral-quota" block and modules-right entries
  3. remove the @import "mistral-quota.css" line in style.css
"""

from __future__ import annotations

import html
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ADMIN_URL = "https://admin.mistral.ai/subscription"
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36"
CACHE_TTL = 270
STALE_TTL = 900
HTTP_TIMEOUT = 8
CACHE_NAME = "waybar-mistral-quota.data"
VIEW_NAME = "waybar-mistral-quota.view"


class SessionError(Exception):
    """The browser session is missing or expired."""


class FetchError(Exception):
    """The page could not be fetched or parsed."""


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


def firefox_profile() -> Path | None:
    root = Path.home() / ".mozilla" / "firefox"
    profiles: list[str] = []
    try:
        ini = (root / "profiles.ini").read_text(encoding="utf-8")
        profiles.extend(m.group(1).strip() for m in re.finditer(r"^Path=(.+)$", ini, re.M))
    except OSError:
        pass
    try:
        profiles.extend(entry.name for entry in root.iterdir())
    except OSError:
        pass
    for profile in profiles:
        candidate = root / profile
        if (candidate / "cookies.sqlite").exists():
            return candidate
    return None


def cookie_header() -> str | None:
    manual = os.environ.get("MISTRAL_COOKIE", "").strip()
    if manual:
        return manual

    profile = firefox_profile()
    if profile is None:
        return None
    db = profile / "cookies.sqlite"
    try:
        uri = f"file:{db}?immutable=1"
        with sqlite3.connect(uri, uri=True, timeout=2) as conn:
            rows = conn.execute(
                "select name || '=' || value from moz_cookies "
                "where host = '.mistral.ai' "
                "and (name like 'ory_session%' or name like 'csrf_token%') "
                "order by lastAccessed desc;"
            ).fetchall()
    except sqlite3.Error as exc:
        debug(f"cookie database read failed: {exc}")
        return None
    pairs = [row[0] for row in rows if row and isinstance(row[0], str) and "=" in row[0]]
    return "; ".join(pairs) if pairs else None


def parse_allowance(text: str, label: str) -> dict | None:
    for match in re.finditer(re.escape(label), text):
        window = text[match.start() : match.start() + 700]
        amount = re.search(r"\$([\d,]+(?:\.\d+)?)\s*\$([\d,]+(?:\.\d+)?)", window)
        if amount is None:
            continue
        used = float(amount.group(1).replace(",", ""))
        total = float(amount.group(2).replace(",", ""))
        if used < 0 or total <= 0:
            continue
        reset = re.search(r"Resets in (\d+) days?", window)
        return {
            "used": used,
            "total": total,
            "reset_days": int(reset.group(1)) if reset else None,
        }
    return None


def parse_page(page: bytes) -> dict | None:
    text = page.decode("utf-8", "replace")
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text)

    api = parse_allowance(text, "Included API usage")
    vibe = parse_allowance(text, "Included Vibe Code usage")
    if api is None and vibe is None:
        return None
    return {"api": api, "vibe": vibe}


def fetch_allowances() -> dict:
    cookie = cookie_header()
    if not cookie:
        raise SessionError(
            "No Mistral admin session found. Sign in at admin.mistral.ai "
            "in Firefox or set MISTRAL_COOKIE."
        )

    request = urllib.request.Request(
        ADMIN_URL,
        headers={
            "Cookie": cookie,
            "User-Agent": USER_AGENT,
            "Accept": "text/html",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
            if not response.url.startswith("https://admin.mistral.ai/"):
                raise SessionError("Mistral admin session expired. Sign in again.")
            raw = response.read(600_000)
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise SessionError(
                f"HTTP {exc.code}: Mistral admin session expired. "
                "Sign in again at admin.mistral.ai."
            ) from exc
        raise FetchError(f"HTTP {exc.code} while fetching the subscription page.") from exc
    except SessionError:
        raise
    except Exception as exc:
        raise FetchError(f"fetch failed: {exc}") from exc

    parsed = parse_page(raw)
    if parsed is None:
        raise SessionError(
            "Mistral subscription page did not contain the expected allowances. "
            "Sign in again at admin.mistral.ai."
        )
    return parsed


def load_cache(now: float) -> dict | None:
    data = read_json(cache_dir() / CACHE_NAME)
    if not isinstance(data, dict):
        return None
    at = data.get("at")
    if isinstance(at, bool) or not isinstance(at, (int, float)):
        return None
    if now - at > STALE_TTL:
        return None

    result: dict = {"at": float(at)}
    for name in ("api", "vibe"):
        entry = data.get(name)
        if entry is None:
            continue
        if not isinstance(entry, dict):
            return None
        used = entry.get("used")
        total = entry.get("total")
        reset = entry.get("reset_days")
        if (
            isinstance(used, bool)
            or not isinstance(used, (int, float))
            or used < 0
            or isinstance(total, bool)
            or not isinstance(total, (int, float))
            or total <= 0
        ):
            return None
        if reset is not None and (
            isinstance(reset, bool) or not isinstance(reset, int) or reset < 0
        ):
            return None
        result[name] = {
            "used": float(used),
            "total": float(total),
            "reset_days": reset,
        }
    if "api" not in result and "vibe" not in result:
        return None
    return result


def save_cache(data: dict, now: float) -> None:
    payload = {"at": now}
    for name in ("api", "vibe"):
        if data.get(name) is not None:
            payload[name] = data[name]
    write_atomic(cache_dir() / CACHE_NAME, json.dumps(payload, separators=(",", ":")))


def view() -> str:
    return read_text(cache_dir() / VIEW_NAME) or "compact"


def percent(entry: dict) -> float:
    return min(100.0, max(0.0, entry["used"] / entry["total"] * 100))


def display_pct(entry: dict) -> str:
    if entry["used"] >= entry["total"]:
        return "MAX"
    value = percent(entry)
    if value >= 10:
        return f"{value:.0f}%"
    return f"{value:.1f}%"


def money(value: float) -> str:
    if value == int(value):
        return f"${value:,.0f}"
    return f"${value:,.2f}"


def bar(value: float) -> str:
    filled = int(round(max(0.0, min(100.0, value)) / 10))
    if value > 0 and filled == 0:
        filled = 1
    return "█" * filled + "░" * (10 - filled)


def state_class(data: dict) -> str:
    entries = [entry for entry in (data.get("vibe"), data.get("api")) if entry]
    if any(entry["used"] >= entry["total"] for entry in entries):
        return "max"
    worst = max(percent(entry) for entry in entries)
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
    last_success: float | None = None,
) -> dict:
    vibe = data.get("vibe")
    api = data.get("api")
    primary = vibe or api
    primary_label = "V" if vibe else "A"

    if view() == "expanded":
        parts = []
        if vibe:
            parts.append(f"V {display_pct(vibe)}")
        if api:
            parts.append(f"A {display_pct(api)}")
        text = "MIS " + "  ".join(parts)
    else:
        text = f"MIS {primary_label} {display_pct(primary)}"
    if stale:
        text = text.replace("MIS ", "MIS ~ ", 1)

    if primary["used"] >= primary["total"]:
        state = "rate limited"
    else:
        state = f"{display_pct(primary)} {'Vibe' if vibe else 'API'} used"

    lines = [f"<b>Mistral Education</b> - {state}"]
    for label, entry in (("Vibe", vibe), ("API", api)):
        if not entry:
            continue
        amount = f"{money(entry['used'])} / {money(entry['total'])}"
        pct_text = "MAX" if entry["used"] >= entry["total"] else f"{display_pct(entry)} used"
        reset = (
            f"resets in {entry['reset_days']}d"
            if entry.get("reset_days") is not None
            else ""
        )
        lines.append(
            "<tt>{label:<4} {bar}  {amount:<14} {pct:<10} {reset}</tt>".format(
                label=label,
                bar=bar(percent(entry)),
                amount=amount,
                pct=pct_text,
                reset=reset,
            )
        )

    lines.append("")
    lines.append("<tt>Caps: Vibe $150, API $15 per calendar month</tt>")

    if stale and last_success is not None:
        minutes = max(0, int((now - last_success) // 60))
        age = f"{minutes}m" if minutes < 60 else f"{minutes // 60}h {minutes % 60}m"
        updated = time.strftime("%H:%M:%S", time.localtime(last_success))
        lines.append(f"<tt>Last good {updated} ({age} ago) - refresh failed</tt>")
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
        "tooltip": (
            "<b>Mistral Education</b> - unavailable\n"
            f"<tt>{html.escape(message)}</tt>"
        ),
    }


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    now = now_epoch()
    fixture = os.environ.get("MISTRAL_QUOTA_FIXTURE")
    if fixture:
        try:
            raw = Path(fixture).read_bytes()
        except OSError as exc:
            print(json.dumps(unavailable(f"fixture read failed: {exc}")))
            return 0
        parsed = parse_page(raw)
        if parsed is None:
            print(json.dumps(unavailable("fixture did not contain Mistral allowances")))
            return 0
        print(json.dumps(render(parsed, now), ensure_ascii=False))
        return 0

    cached = load_cache(now)
    if cached is not None and now - cached["at"] < CACHE_TTL:
        print(json.dumps(render(cached, now), ensure_ascii=False))
        return 0

    try:
        fetched = fetch_allowances()
    except SessionError as exc:
        debug(str(exc))
        print(json.dumps(unavailable(str(exc), auth=True)))
        return 0
    except FetchError as exc:
        debug(str(exc))
        if cached is not None:
            print(json.dumps(
                render(
                    cached,
                    now,
                    stale=True,
                    error=str(exc),
                    last_success=cached["at"],
                ),
                ensure_ascii=False,
            ))
            return 0
        print(json.dumps(unavailable(str(exc))))
        return 0

    save_cache(fetched, now)
    print(json.dumps(render(fetched, now), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
