#!/usr/bin/env bash
set -euo pipefail

# One bounded Codex app-server request per Waybar poll.
export CODEX_QUOTA_TIMEOUT=8
exec python3 - <<'PY'
import json, os, select, shutil, signal, subprocess, time

UNAVAILABLE = {"text": "N/A", "alt": "N/A", "class": "unavailable", "tooltip": "Codex quota unavailable"}
def emit(value):
    print(json.dumps(value, separators=(",", ":"), ensure_ascii=True))
def fail():
    emit(UNAVAILABLE)

def state_dir():
    base = os.environ.get("XDG_CACHE_HOME") or os.path.join(os.environ.get("HOME", "/tmp"), ".cache")
    return base
def read_state(name):
    try:
        with open(os.path.join(state_dir(), name)) as f:
            return f.read().strip()
    except OSError:
        return ""
def write_state(name, value):
    try:
        path = os.path.join(state_dir(), name)
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            f.write(value)
        os.replace(tmp, path)
    except OSError:
        pass

CACHE_TTL = 270
def load_cache():
    try:
        with open(os.path.join(state_dir(), "waybar-codex-quota.data")) as f:
            data = json.load(f)
        if not isinstance(data, dict): return None
        at = data.get("at")
        if isinstance(at, bool) or not isinstance(at, (int, float)): return None
        if time.time() - at >= CACHE_TTL: return None
        five = data.get("five"); week = data.get("week")
        five_reset = data.get("five_reset"); week_reset = data.get("week_reset")
        for v in (five, week):
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not 0 <= v <= 100: return None
        for r in (five_reset, week_reset):
            if isinstance(r, bool) or not isinstance(r, (int, float)) or r <= 0: return None
        return data
    except (OSError, ValueError):
        return None
def save_cache(details):
    try:
        data = {"five":details[0][1], "week":details[1][1], "five_reset":details[0][2], "week_reset":details[1][2], "at":time.time()}
        path = os.path.join(state_dir(), "waybar-codex-quota.data")
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f)
        os.replace(tmp, path)
    except OSError:
        pass
def fmt_countdown(resets):
    left = max(0, int(resets - time.time()))
    if left < 60: return "<1m"
    days, remainder = divmod(left, 86400)
    hours, minutes = divmod(remainder, 3600)[0], (remainder % 3600) // 60
    return f"{days}d {hours}h {minutes}m" if days else f"{hours}h {minutes}m"
def render_quota(details):
    expanded = read_state("waybar-codex-quota.view") == "expanded"
    text = f"5h {details[0][1]:g}%  W {details[1][1]:g}%" if expanded else f"5h {details[0][1]:g}%"
    emit({"text":text, "alt":f"5h {details[0][1]:g}%  W {details[1][1]:g}%", "class":"codex-quota", "tooltip":f"Codex quota remaining (rolling limits)\n5-hour limit: {details[0][1]:g}% remaining, resets in {fmt_countdown(details[0][2])}\nWeekly limit: {details[1][1]:g}% remaining, resets in {fmt_countdown(details[1][2])}"})

proc = None
buffer = b""
def wait_ready(fd, writable, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError()
    readable, writeable, exceptional = select.select(
        [] if writable else [fd], [fd] if writable else [], [fd], remaining
    )
    if exceptional:
        raise ValueError()
    if not (writeable if writable else readable):
        raise TimeoutError()

def write_request(request, deadline):
    view = memoryview(request)
    while view:
        wait_ready(proc.stdin.fileno(), True, deadline)
        try:
            written = os.write(proc.stdin.fileno(), view)
        except BlockingIOError:
            continue
        if written <= 0:
            raise ValueError()
        view = view[written:]

def rpc(ident, method, params, deadline):
    request = json.dumps({"jsonrpc":"2.0", "id":ident, "method":method, "params":params}, separators=(",", ":")).encode() + b"\n"
    write_request(request, deadline)
    while True:
        if time.monotonic() >= deadline:
            raise TimeoutError()
        if b"\n" in buffer:
            line, remainder = buffer.split(b"\n", 1)
            globals()["buffer"] = remainder
            msg = json.loads(line)
            if isinstance(msg, dict) and msg.get("id") == ident:
                if "error" in msg or "result" not in msg:
                    raise ValueError()
                return msg["result"]
            continue
        wait_ready(proc.stdout.fileno(), False, deadline)
        try:
            chunk = os.read(proc.stdout.fileno(), 4096)
        except BlockingIOError:
            continue
        if not chunk:
            raise ValueError()
        globals()["buffer"] += chunk

try:
    cached = load_cache()
    if cached is not None:
        render_quota([("5h", cached["five"], cached["five_reset"]), ("week", cached["week"], cached["week_reset"])])
        raise SystemExit(0)
    timeout = max(0.01, float(os.environ.get("CODEX_QUOTA_TIMEOUT", "8")))
    deadline = time.monotonic() + timeout
    codex_bin = os.environ.get("CODEX_BIN") or shutil.which("codex") or os.path.expanduser("~/.local/bin/codex")
    proc = subprocess.Popen([codex_bin, "app-server", "--stdio"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
    os.set_blocking(proc.stdin.fileno(), False)
    os.set_blocking(proc.stdout.fileno(), False)
    rpc(1, "initialize", {"clientInfo":{"name":"waybar-codex-quota","version":"1"}}, deadline)
    write_request(b'{"jsonrpc":"2.0","method":"initialized","params":{}}\n', deadline)
    result = rpc(2, "account/rateLimits/read", {}, deadline)
    if not isinstance(result, dict): raise ValueError()
    limits = result.get("rateLimitsByLimitId", {}).get("codex") if isinstance(result.get("rateLimitsByLimitId"), dict) else None
    if limits is None: limits = result.get("rateLimits")
    if not isinstance(limits, dict): raise ValueError()
    windows = [limits.get("primary"), limits.get("secondary")]
    expected = (300, 10080)
    labels = ("5h", "week")
    details=[]
    for window, duration, label in zip(windows, expected, labels):
        if not isinstance(window, dict) or window.get("windowDurationMins") != duration: raise ValueError()
        used=window.get("usedPercent"); resets=window.get("resetsAt")
        if isinstance(used, bool) or not isinstance(used, (int,float)) or not 0 <= used <= 100: raise ValueError()
        if isinstance(resets, bool) or not isinstance(resets, (int,float)) or resets <= 0: raise ValueError()
        details.append((label, 100 - used, resets))
    save_cache(details)
    write_state("waybar-codex-quota.last", "ok")
    render_quota(details)
except Exception:
    write_state("waybar-codex-quota.last", "na")
    fail()
finally:
    if proc:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        except Exception:
            pass
        try:
            proc.wait(timeout=0.2)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            except Exception:
                pass
        try:
            proc.wait(timeout=0.2)
        except Exception:
            pass
PY
