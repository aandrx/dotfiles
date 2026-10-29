def export_rows(source: str) -> str:
    """Normalize non-empty source rows into a newline-terminated export."""
    rows = source.splitlines()
    if source and not source.endswith("\n"):
        rows = rows[:-1]
    return "".join(f"{row.strip()}\n" for row in rows if row.strip())
