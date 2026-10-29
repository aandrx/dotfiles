def parse_amount(value: str) -> float:
    cleaned = value.strip().replace(",", "")
    return float(cleaned) if cleaned else 0.0


def compute_total(rows: list[str]) -> float:
    total = 0.0
    for row in rows:
        total += parse_amount(row)
    return round(total, 2)
