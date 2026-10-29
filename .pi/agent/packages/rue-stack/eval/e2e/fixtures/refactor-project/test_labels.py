import unittest

from labels import format_invoice_label, format_receipt_label


class LabelsTest(unittest.TestCase):
    def test_invoice(self):
        self.assertEqual(format_invoice_label(" acme ", 12.5), "INVOICE ACME: 12.50")

    def test_receipt(self):
        self.assertEqual(format_receipt_label(" beta ", 3.0), "RECEIPT BETA: 3.00")


if __name__ == "__main__":
    unittest.main()
