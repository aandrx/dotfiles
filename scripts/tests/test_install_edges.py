"""Edge-case regressions for install, install-system and capture safety."""

import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO_SOURCE = Path(__file__).resolve().parents[2]
SCRIPTS = ("privacy-check.py", "capture.sh", "install.sh", "install-system.sh")
COMMANDS = (
    "bash",
    "basename",
    "cmp",
    "cp",
    "date",
    "dirname",
    "git",
    "id",
    "install",
    "mkdir",
    "mktemp",
    "mv",
    "python3",
    "readlink",
    "realpath",
    "rm",
    "sort",
    "stat",
    "uname",
)


class RepoCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self.repo = base / "repo"
        self.home = base / "home"
        self.base = base
        self.repo.mkdir()
        self.home.mkdir()
        scripts = self.repo / "scripts"
        scripts.mkdir()
        for name in SCRIPTS:
            shutil.copy2(REPO_SOURCE / "scripts" / name, scripts / name)
        self.env = os.environ.copy()
        self.env.update(
            {
                "HOME": str(self.home),
                "GIT_CONFIG_GLOBAL": "/dev/null",
                "GIT_CONFIG_SYSTEM": "/dev/null",
                "GIT_AUTHOR_NAME": "Edge Test",
                "GIT_AUTHOR_EMAIL": "edge-test@example.invalid",
                "GIT_COMMITTER_NAME": "Edge Test",
                "GIT_COMMITTER_EMAIL": "edge-test@example.invalid",
            }
        )
        self.git("init", "-q")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def git(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ("git", "-C", str(self.repo), *args),
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=self.env,
        )

    def write(self, rel: str, content: str, mode: int | None = None) -> Path:
        path = self.repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        if mode is not None:
            path.chmod(mode)
        return path

    def write_home(self, rel: str, content: str, mode: int | None = None) -> Path:
        path = self.home / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        if mode is not None:
            path.chmod(mode)
        return path

    def commit_tracked(self, *rels: str) -> None:
        self.git("add", "--", *rels)
        self.git("commit", "-q", "-m", "fixture")

    def run_script(
        self,
        name: str,
        *args: str,
        env: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        merged = self.env.copy()
        if env:
            merged.update(env)
        return subprocess.run(
            (str(self.repo / "scripts" / name), *args),
            cwd=self.repo,
            env=merged,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def fake_bin(self, node=True, npm_exit=0, npm_touch=None) -> Path:
        fakebin = self.base / "fakebin"
        fakebin.mkdir(exist_ok=True)
        if node:
            node_path = fakebin / "node"
            node_path.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            node_path.chmod(0o755)
        npm = fakebin / "npm"
        touch = f"touch '{npm_touch}'\n" if npm_touch else ""
        npm.write_text(f"#!/bin/sh\n{touch}exit {npm_exit}\n", encoding="utf-8")
        npm.chmod(0o755)
        return fakebin

    def shim_without(self, excluded: tuple[str, ...]) -> Path:
        shim = self.base / "shim"
        shim.mkdir(exist_ok=True)
        for name in COMMANDS:
            if name in excluded:
                continue
            target = shutil.which(name)
            if target:
                (shim / name).symlink_to(target)
        return shim


class InstallEdgeTests(RepoCase):
    def test_repo_only_config_is_not_deployed(self) -> None:
        self.write(".gitleaks.toml", "[allowlist]\n")
        self.write(".github/hooks/pre-commit", "#!/bin/sh\n")
        self.write(".github/hooks/privacy.yml", "private: true\n")
        self.commit_tracked(
            ".gitleaks.toml", ".github/hooks/pre-commit", ".github/hooks/privacy.yml"
        )
        result = self.run_script("install.sh", "--no-deps")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.home / ".gitleaks.toml").exists())
        self.assertFalse((self.home / ".github/hooks/pre-commit").exists())
        self.assertFalse((self.home / ".github/hooks/privacy.yml").exists())

    def test_untracked_package_manifest_is_not_read_or_run(self) -> None:
        marker = self.base / "npm-ran"
        fakebin = self.fake_bin(npm_touch=marker)
        self.write(".bashrc", "tracked\n")
        self.commit_tracked(".bashrc")
        self.write(
            ".pi/agent/packages/local/package.json",
            '{"name":"local","dependencies":{"dep":"1.0.0"},"scripts":{"preinstall":"bad"}}\n',
        )
        result = self.run_script(
            "install.sh",
            env={"PATH": f"{fakebin}:{self.env['PATH']}"},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(marker.exists())
        self.assertNotIn("npm    install local", result.stdout)
        self.assertFalse((self.home / ".pi/agent/packages/local").exists())

    def test_dry_run_reports_dependencies_on_fresh_home(self) -> None:
        self.write(
            ".pi/agent/packages/demo/package.json",
            '{"name":"demo","version":"1.0.0","dependencies":{"dep":"1.0.0"}}\n',
        )
        self.commit_tracked(".pi/agent/packages/demo/package.json")
        marker = self.base / "npm-ran"
        fakebin = self.fake_bin(npm_touch=marker)
        result = self.run_script(
            "install.sh",
            "--dry-run",
            env={"PATH": f"{fakebin}:{self.env['PATH']}"},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("npm    install demo", result.stdout)
        self.assertFalse(marker.exists())
        self.assertFalse((self.home / ".pi/agent/packages/demo").exists())

    def test_missing_node_fails_with_metadata_guidance(self) -> None:
        self.write(
            ".pi/agent/packages/demo/package.json",
            '{"name":"demo","dependencies":{"dep":"1.0.0"}}\n',
        )
        self.commit_tracked(".pi/agent/packages/demo/package.json")
        shim = self.shim_without(("node", "npm"))
        result = self.run_script("install.sh", env={"PATH": str(shim)})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Node.js is required for demo", result.stderr)
        self.assertIn(".pi/agent/packages/demo/package.json", result.stderr)

    def test_preflight_errors_are_metadata_only_and_block_writes(self) -> None:
        value = "synthetic-" + "private-value-for-test"
        self.write(".bashrc", "password=" + value + "\n")
        self.commit_tracked(".bashrc")
        result = self.run_script("install.sh", "--dry-run", "--no-deps")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(".bashrc", result.stderr)
        self.assertIn("password-assignment", result.stderr)
        self.assertNotIn(value, result.stdout + result.stderr)
        self.assertEqual(list(self.home.iterdir()), [])

    def test_symlink_to_denied_live_credential_is_refused(self) -> None:
        self.write(".config/app/ok.conf", "ok\n")
        self.write(".pi/agent/auth.json", '{"token":"synthetic"}\n')
        self.commit_tracked(".config/app/ok.conf")
        (self.repo / ".config/app/credlink").symlink_to("../../.pi/agent/auth.json")
        self.commit_tracked(".config/app/credlink")
        result = self.run_script("install.sh", "--no-deps")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(".config/app/credlink", result.stderr)
        self.assertNotIn("synthetic", result.stdout + result.stderr)
        self.assertFalse((self.home / ".config/app/credlink").exists())
        self.assertFalse((self.home / ".config/app/ok.conf").exists())

    def test_dry_run_link_conflict_is_nonzero(self) -> None:
        self.write(".config/app/a.conf", "new\n")
        self.commit_tracked(".config/app/a.conf")
        self.write_home(".config/app/a.conf", "old\n")
        result = self.run_script("install.sh", "--link", "--dry-run", "--no-deps")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("already exists", result.stderr)
        self.assertEqual((self.home / ".config/app/a.conf").read_text(), "old\n")

    def test_safe_tracked_symlink_target_is_deployed(self) -> None:
        self.write(".config/app/real.conf", "real\n")
        (self.repo / ".config/app/link.conf").symlink_to("real.conf")
        self.commit_tracked(".config/app/real.conf", ".config/app/link.conf")
        result = self.run_script("install.sh", "--no-deps")
        self.assertEqual(result.returncode, 0, result.stderr)
        link = self.home / ".config/app/link.conf"
        self.assertTrue(link.is_symlink())
        self.assertEqual(os.readlink(link), "real.conf")
        self.assertEqual((self.home / ".config/app/real.conf").read_text(), "real\n")
        result = self.run_script("install.sh", "--no-deps")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(list(self.home.glob(".dotfiles-backup-*")), [])
        self.assertEqual(os.readlink(link), "real.conf")

    def test_symlink_to_ignored_denied_note_is_refused_without_leak(self) -> None:
        self.write(".config/app/ok.conf", "ok\n")
        self.write(".pi/agent/unfinished-work.md", "sentinel private note\n")
        self.commit_tracked(".config/app/ok.conf")
        (self.repo / ".config/app/leak.conf").symlink_to(
            "../../.pi/agent/unfinished-work.md"
        )
        self.commit_tracked(".config/app/leak.conf")
        result = self.run_script("install.sh", "--no-deps")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(".config/app/leak.conf", result.stderr)
        self.assertNotIn("sentinel private note", result.stdout + result.stderr)
        self.assertFalse((self.home / ".config/app/ok.conf").exists())
        self.assertFalse((self.home / ".config/app/leak.conf").exists())

    def test_home_equal_repo_does_not_chmod_private_source(self) -> None:
        source = self.write(".npmrc", "prefix=${HOME}/.npm-global\n", mode=0o644)
        self.commit_tracked(".npmrc")
        result = self.run_script(
            "install.sh",
            "--no-deps",
            env={"HOME": str(self.repo)},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(stat.S_IMODE(source.stat().st_mode), 0o644)

    def test_link_mode_leaves_source_permissions_untouched(self) -> None:
        source = self.write(".bashrc", "bashrc\n", mode=0o640)
        self.commit_tracked(".bashrc")
        result = self.run_script("install.sh", "--link", "--no-deps")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(stat.S_IMODE(source.stat().st_mode), 0o640)

    def test_destination_ancestor_symlink_is_refused(self) -> None:
        self.write(".config/app/a.conf", "new\n")
        self.commit_tracked(".config/app/a.conf")
        outside = self.base / "outside"
        outside.mkdir()
        (self.home / ".config").symlink_to(outside)
        result = self.run_script("install.sh", "--no-deps")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((outside / "app/a.conf").exists())


class SystemInstallEdgeTests(RepoCase):
    def test_same_content_wrong_script_mode_is_corrected(self) -> None:
        self.write("system/usr/local/sbin/tool", "#!/bin/sh\n", mode=0o755)
        self.commit_tracked("system/usr/local/sbin/tool")
        root = self.base / "root"
        dest = root / "usr/local/sbin/tool"
        dest.parent.mkdir(parents=True)
        dest.write_text("#!/bin/sh\n", encoding="utf-8")
        dest.chmod(0o644)
        result = self.run_script("install-system.sh", "--apply", "--root", str(root))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(stat.S_IMODE(dest.stat().st_mode), 0o755)
        backups = root / "var/backups/dotfiles-system"
        self.assertFalse(backups.exists() and any(backups.iterdir()))

    def test_backup_ancestor_symlink_is_refused_without_writes(self) -> None:
        self.write("system/etc/tool.conf", "new=1\n")
        self.commit_tracked("system/etc/tool.conf")
        root = self.base / "root"
        dest = root / "etc/tool.conf"
        dest.parent.mkdir(parents=True)
        dest.write_text("old=1\n", encoding="utf-8")
        outside = self.base / "outside"
        outside.mkdir()
        (root / "var").mkdir()
        (root / "var/backups").symlink_to(outside)
        result = self.run_script("install-system.sh", "--apply", "--root", str(root))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(dest.read_text(), "old=1\n")
        self.assertEqual(list(outside.iterdir()), [])

    def test_root_symlink_is_refused(self) -> None:
        self.write("system/etc/tool.conf", "new=1\n")
        self.commit_tracked("system/etc/tool.conf")
        outside = self.base / "outside"
        outside.mkdir()
        root = self.base / "root"
        root.symlink_to(outside)
        result = self.run_script("install-system.sh", "--apply", "--root", str(root))
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((outside / "etc/tool.conf").exists())

    def test_backup_base_symlink_is_refused_without_writes(self) -> None:
        self.write("system/etc/tool.conf", "new=1\n")
        self.commit_tracked("system/etc/tool.conf")
        root = self.base / "root"
        dest = root / "etc/tool.conf"
        dest.parent.mkdir(parents=True)
        dest.write_text("old=1\n", encoding="utf-8")
        outside = self.base / "outside-backup"
        outside.mkdir()
        (root / "var/backups").mkdir(parents=True)
        (root / "var/backups/dotfiles-system").symlink_to(outside)
        result = self.run_script("install-system.sh", "--apply", "--root", str(root))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(dest.read_text(), "old=1\n")
        self.assertEqual(list(outside.iterdir()), [])

    def test_tracked_symlink_source_is_refused(self) -> None:
        self.write("system/etc/tool.conf", "new=1\n")
        self.commit_tracked("system/etc/tool.conf")
        self.write("notes.local", "ignored local note\n")
        (self.repo / "system/etc/link.conf").symlink_to("../../notes.local")
        self.commit_tracked("system/etc/link.conf")
        root = self.base / "root"
        result = self.run_script("install-system.sh", "--apply", "--root", str(root))
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((root / "etc/link.conf").exists())
        self.assertFalse((root / "etc/tool.conf").exists())

    def test_source_ancestor_symlink_is_refused_before_writes(self) -> None:
        self.write("system/etc/tool.conf", "new=1\n")
        self.commit_tracked("system/etc/tool.conf")
        outside = self.base / "outside-src"
        outside.mkdir()
        (outside / "tool.conf").write_text("outside\n", encoding="utf-8")
        shutil.rmtree(self.repo / "system/etc")
        (self.repo / "system/etc").symlink_to(outside)
        root = self.base / "root"
        result = self.run_script("install-system.sh", "--apply", "--root", str(root))
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((root / "etc/tool.conf").exists())


class CaptureEdgeTests(RepoCase):
    def test_repository_destination_ancestor_symlink_is_refused(self) -> None:
        self.write(".config/app/a.conf", "old\n")
        self.commit_tracked(".config/app/a.conf")
        outside = self.base / "outside-repo"
        outside.mkdir()
        shutil.rmtree(self.repo / ".config")
        (self.repo / ".config").symlink_to(outside)
        self.write_home(".config/app/a.conf", "new\n")
        result = self.run_script("capture.sh", ".config/app/a.conf")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((outside / "app/a.conf").exists())

    def test_changed_source_symlink_refused_without_partial_write(self) -> None:
        self.write(".bashrc", "old bashrc\n")
        (self.repo / ".config/app").mkdir(parents=True)
        (self.repo / ".config/app/link.conf").symlink_to("old-target")
        self.commit_tracked(".bashrc", ".config/app/link.conf")
        self.write_home(".bashrc", "new bashrc\n")
        (self.home / ".config/app").mkdir(parents=True)
        (self.home / ".config/app/link.conf").symlink_to("new-target")
        result = self.run_script("capture.sh")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unsafe-source-symlink", result.stderr)
        self.assertEqual((self.repo / ".bashrc").read_text(), "old bashrc\n")
        self.assertEqual(
            os.readlink(self.repo / ".config/app/link.conf"), "old-target"
        )

    def test_source_ancestor_symlink_is_refused_before_cmp(self) -> None:
        self.write(".config/app/a.conf", "old\n")
        self.commit_tracked(".config/app/a.conf")
        outside = self.base / "outside-home"
        (outside / "app").mkdir(parents=True)
        (outside / "app/a.conf").write_text("new\n", encoding="utf-8")
        (self.home / ".config").symlink_to(outside)
        result = self.run_script("capture.sh", ".config/app/a.conf")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.repo / ".config/app/a.conf").read_text(), "old\n")


if __name__ == "__main__":
    unittest.main()
