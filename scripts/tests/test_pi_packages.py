"""Guard the patched footer and split-view extensions against package updates.

Both extensions are loaded from local ``./packages`` paths. ``pi update``
reconciles npm and git sources only, so a local path keeps the patch. If a
source ever moves back to npm, the next update overwrites the patched file
and the footer silently loses its additions.
"""

import json
import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SETTINGS = REPO / ".pi/agent/settings.json"
PACKAGES = REPO / ".pi/agent/packages"

LOCAL_SOURCES = ("./packages/pi-context-bar", "./packages/pi-split-view")
NPM_SOURCES = ("npm:pi-context-bar", "npm:pi-split-view")


class PiPackageSourceTests(unittest.TestCase):
    def setUp(self) -> None:
        settings = json.loads(SETTINGS.read_text(encoding="utf-8"))
        self.sources = [
            entry if isinstance(entry, str) else entry.get("source")
            for entry in settings.get("packages", [])
        ]

    def test_patched_extensions_load_from_local_packages(self) -> None:
        for source in LOCAL_SOURCES:
            self.assertIn(source, self.sources)

    def test_no_npm_source_can_overwrite_a_patch(self) -> None:
        for source in NPM_SOURCES:
            self.assertNotIn(source, self.sources)

    def test_footer_patch_is_present(self) -> None:
        text = (PACKAGES / "pi-context-bar/extensions/context-bar.ts").read_text(encoding="utf-8")
        self.assertIn("session_info", text, "session name segment is missing")
        self.assertIn("CH ", text, "cache-hit segment is missing")

    def test_split_view_files_widget_stays_disabled(self) -> None:
        text = (PACKAGES / "pi-split-view/split-view.ts").read_text(encoding="utf-8")
        self.assertRegex(
            text,
            r"function widgetLines\([^)]*\)[^{]*\{\s*return \[\];",
            "recent-files widget is rendering again",
        )


if __name__ == "__main__":
    unittest.main()
