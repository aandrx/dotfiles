import unittest

from ledger import compute_total, parse_amount


class LedgerTest(unittest.TestCase):
    def test_parse_blank(self):
        self.assertEqual(parse_amount("  "), 0.0)

    def test_total_rounds(self):
        self.assertEqual(compute_total(["1.005", "2.005"]), 3.01)


if __name__ == "__main__":
    unittest.main()
