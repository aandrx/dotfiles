"""Install the actual indexed public tree into a scratch HOME, without history."""
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class PublicSnapshotTests(unittest.TestCase):
    def test_indexed_export_installs_without_ignored_private_files(self):
        # Read only indexed public blobs. Never copy the raw checkout or HOME.
        listing = subprocess.check_output(["git", "-C", str(ROOT), "ls-files", "--stage", "-z"])
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            export = base / "public"
            home = base / "home"
            export.mkdir()
            home.mkdir()
            paths = []
            for record in listing.split(b"\0"):
                if not record:
                    continue
                header, encoded_path = record.split(b"\t", 1)
                mode, object_id, stage = header.split()
                self.assertEqual(stage, b"0", "resolve index conflicts before export")
                rel = os.fsdecode(encoded_path)
                path = export / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                data = subprocess.check_output(["git", "-C", str(ROOT), "cat-file", "blob", object_id.decode()])
                if mode == b"120000":
                    path.symlink_to(os.fsdecode(data))
                else:
                    self.assertIn(mode, (b"100644", b"100755"))
                    path.write_bytes(data)
                    path.chmod(int(mode[-3:], 8))
                paths.append(rel)
            env = dict(os.environ, HOME=str(home), GIT_CONFIG_GLOBAL="/dev/null",
                       GIT_CONFIG_SYSTEM="/dev/null", GIT_CONFIG_NOSYSTEM="1")
            subprocess.run(["git", "init", "-q", str(export)], check=True, env=env)
            # Explicit manifest paths only, never a sweep of the fixture folder.
            subprocess.run(["git", "-C", str(export), "add", "--", *paths], check=True, env=env)
            ignored = export / ".pi/agent/unfinished-work.md"
            ignored.parent.mkdir(parents=True, exist_ok=True)
            ignored.write_text("Synthetic private-note sentinel; not distributable.\n")
            for rel in ("system/etc/default/grub", ".pi/agent/skills/frontend-design/SKILL.md"):
                self.assertNotIn(rel, paths)
            script = export / "scripts/install.sh"
            # A dry run must not even create a destination file or backup.
            dry = subprocess.run([str(script), "--dry-run", "--no-deps"], env=env,
                                 text=True, capture_output=True, cwd=export)
            self.assertEqual(dry.returncode, 0, dry.stderr)
            self.assertEqual(list(home.iterdir()), [])
            for _ in range(2):
                result = subprocess.run([str(script), "--no-deps"], env=env,
                                        text=True, capture_output=True, cwd=export)
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((home / ".pi/agent/unfinished-work.md").exists())
            self.assertFalse((home / ".gitleaks.toml").exists())
            self.assertFalse((home / "system").exists())
            self.assertEqual(list(home.glob(".dotfiles-backup-*")), [])
            for package in ("pi-context-bar", "pi-split-view"):
                self.assertTrue((home / f".pi/agent/packages/{package}/package.json").is_file())
            self.assertTrue((home / ".pi/agent/packages/pi-context-bar/extensions/context-bar.ts").is_file())
            self.assertTrue(stat.S_IMODE((home / ".npmrc").stat().st_mode) == 0o600)
            result = subprocess.run(["python3", "scripts/privacy-check.py", "--staged"],
                                    env=env, text=True, capture_output=True, cwd=export)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
