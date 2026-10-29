def format_invoice_label(name: str, amount: float) -> str:
    label = name.strip().upper()
    return f"INVOICE {label}: {amount:.2f}"


def format_receipt_label(name: str, amount: float) -> str:
    label = name.strip().upper()
    return f"RECEIPT {label}: {amount:.2f}"
