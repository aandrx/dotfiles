import unittest

from csv_export import export_rows


class ExportRowsTest(unittest.TestCase):
    def test_trailing_newline(self):
        self.assertEqual(export_rows("alpha\nbeta\n"), "alpha\nbeta\n")

    def test_no_trailing_newline_keeps_final_row(self):
        self.assertEqual(export_rows("alpha\nbeta"), "alpha\nbeta\n")


if __name__ == "__main__":
    unittest.main()
