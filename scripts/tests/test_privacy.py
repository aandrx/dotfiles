import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_SOURCE = Path(__file__).resolve().parents[2]
SCRIPTS = (
    "privacy-check.py",
    "capture.sh",
    "install.sh",
    "check-pi-extension-imports.sh",
)


def token(prefix: str, length: int = 28) -> str:
    return prefix + ("A" * length)


def home_path(name: str) -> str:
    return "/" + "home/" + name


def ipv4(*parts: int) -> str:
    return ".".join(str(part) for part in parts)


def uuid_text(*parts: str) -> str:
    return "-".join(parts)


def assignment_line(key: str, value: str, quoted: bool = False) -> str:
    if quoted:
        return '"' + key + '": "' + value + '"'
    return key + "=" + value


class RepoCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self.repo = base / "repo"
        self.home = base / "home"
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
                "GIT_AUTHOR_NAME": "Privacy Test",
                "GIT_AUTHOR_EMAIL": "privacy-test@example.invalid",
                "GIT_COMMITTER_NAME": "Privacy Test",
                "GIT_COMMITTER_EMAIL": "privacy-test@example.invalid",
            }
        )
        self.git("init", "-q")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def git(self, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ("git", "-C", str(self.repo), *args),
            check=check,
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
        for rel in rels:
            self.git("add", "--", rel)
        self.git("commit", "-q", "-m", "fixture")

    def run_script(
        self,
        name: str,
        *args: str,
        env: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        run_env = dict(self.env)
        if env:
            run_env.update(env)
        return subprocess.run(
            (str(self.repo / "scripts" / name), *args),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=run_env,
            cwd=self.repo,
        )

    def run_checker(self, *args: str) -> subprocess.CompletedProcess[str]:
        return self.run_script("privacy-check.py", *args)


class PrivacyCheckerTests(RepoCase):
    def test_denied_paths_are_refused_without_values(self) -> None:
        secret = token("ghp_", 30)
        self.write(".ssh/id_rsa", secret)
        self.commit_tracked(".ssh/id_rsa")
        result = self.run_checker()
        self.assertNotEqual(result.returncode, 0)
        output = result.stdout + result.stderr
        self.assertIn(".ssh/id_rsa", output)
        self.assertIn("denied-path", output)
        self.assertNotIn(secret, output)

    def test_denied_queries_cover_private_paths(self) -> None:
        for rel in (
            ".pi/agent/machine-idle-plan.md",
            ".pi/agent/dsh-sync-plan.md",
            ".pi/agent/unfinished-work.md",
            ".pi/agent/wifi-home.md",
            ".pi/agent/skills/frontend-design/SKILL.md",
            ".bashrc.local",
            ".gitconfig.local",
            ".env",
            ".env.production",
            ".pi/agent/mcp-auth.json",
            ".pi/agent/mcp-auth.json.bak",
            "relocated/config/mcp-auth-2.json",
            ".netrc",
            ".aws/credentials",
            "system/etc/default/grub",
        ):
            result = self.run_checker("--denied", rel)
            self.assertEqual(result.returncode, 0, rel)
        for rel in (".env.example", ".config/app/config", "system/etc/default/grub.example"):
            result = self.run_checker("--denied", rel)
            self.assertEqual(result.returncode, 1, rel)

    def test_npm_token_is_detected_and_not_printed(self) -> None:
        secret = token("npm_", 30)
        self.write(".npmrc", f"//registry.npmjs.org/:_authToken={secret}\n")
        self.commit_tracked(".npmrc")
        result = self.run_checker()
        self.assertNotEqual(result.returncode, 0)
        output = result.stdout + result.stderr
        self.assertIn(".npmrc", output)
        self.assertTrue("npm-token" in output or "registry-auth" in output)
        self.assertNotIn(secret, output)

    def test_portability_and_machine_identity_rules(self) -> None:
        self.write(
            ".config/app/test.conf",
            home_path("alice/project")
            + "\nhost="
            + ipv4(192, 168, 1, 20)
            + "\ntail="
            + ipv4(100, 64, 0, 7)
            + "\n",
        )
        self.write(
            "system/etc/other.conf",
            'OS_PROBER_SKIP_LIST="'
            + uuid_text("7f53e58e", "cf92", "4fb8", "81f7", "6dc1e4457c84")
            + '@/dev/nvme0n1p2"\n',
        )
        self.commit_tracked(".config/app/test.conf", "system/etc/other.conf")
        output = self.run_checker().stderr
        self.assertIn("nonportable-home", output)
        self.assertIn("private-ip", output)
        self.assertIn("boot-uuid", output)

    def test_inline_allow_marker_cannot_bypass_findings(self) -> None:
        secret = token("npm_", 30)
        self.write(
            ".config/app/test.conf",
            home_path("alice/project")
            + " # privacy-check: allow=nonportable-home\n"
            + home_path("bob/project")
            + " # privacy-check: allow=nonportable-home\n"
            + "token="
            + secret
            + " # privacy-check: allow=npm-token\n",
        )
        self.commit_tracked(".config/app/test.conf")
        result = self.run_checker()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("test.conf:1: nonportable-home", result.stderr)
        self.assertIn("test.conf:2: nonportable-home", result.stderr)
        self.assertIn("test.conf:3: npm-token", result.stderr)
        self.assertNotIn(secret, result.stdout + result.stderr)
        self.assertNotIn(home_path("alice"), result.stderr)
        self.assertNotIn(home_path("bob"), result.stderr)

    @unittest.skipIf(os.geteuid() == 0, "root can read mode-000 files")
    def test_unreadable_content_fails_closed(self) -> None:
        path = self.write(".config/app/test.conf", "ordinary\n")
        self.commit_tracked(".config/app/test.conf")
        path.chmod(0)
        try:
            result = self.run_checker()
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("unreadable-file", result.stderr)
        finally:
            path.chmod(0o600)

    def test_assignment_false_positives_are_ignored(self) -> None:
        self.write(
            ".config/xdg-desktop-portal/portals.conf",
            "org.freedesktop.impl.portal.Secret=gnome-keyring;\n"
            "# pass: runAgent handles this path\n",
        )
        self.commit_tracked(".config/xdg-desktop-portal/portals.conf")
        result = self.run_checker()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_assignment_placeholders_and_quoted_keys(self) -> None:
        self.write(
            ".config/app/safe.conf",
            assignment_line("pass" + "word", "changeme")
            + "\n"
            + assignment_line("pass" + "word", "${DB_PASSWORD}")
            + "\n"
            + assignment_line("client_" + "secret", "process.env.CLIENT_SECRET")
            + "\n",
        )
        self.write(
            ".config/app/risky.conf",
            assignment_line("pass" + "word", "example-real-pass-123")
            + "\n"
            + assignment_line("pass" + "word", "xxx-real-pass-123", quoted=True)
            + "\n"
            + assignment_line("client_" + "secret", "prod-secret-value-42", quoted=True)
            + "\n"
            + assignment_line("_auth" + "Token", "actual-registry-value-42", quoted=True)
            + "\n",
        )
        self.commit_tracked(".config/app/safe.conf", ".config/app/risky.conf")
        output = self.run_checker().stderr
        self.assertNotIn("safe.conf", output)
        self.assertIn("risky.conf:1: password-assignment", output)
        self.assertIn("risky.conf:2: password-assignment", output)
        self.assertIn("risky.conf:3: secret-assignment", output)
        self.assertIn("risky.conf:4: registry-auth", output)
        for value in (
            "example-real-pass-123",
            "xxx-real-pass-123",
            "prod-secret-value-42",
            "actual-registry-value-42",
        ):
            self.assertNotIn(value, output)

    def test_openai_sk_family_is_detected(self) -> None:
        secret = "sk-" + "proj-" + ("A" * 28)
        self.write(".config/app/test.conf", "value=" + secret + "\n")
        self.commit_tracked(".config/app/test.conf")
        result = self.run_checker()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("openai-token", result.stderr)
        self.assertNotIn(secret, result.stderr)

    def test_gitconfig_identity_and_plaintext_helper_are_rejected(self) -> None:
        self.write(
            ".gitconfig",
            "[user]\n\tname = Synthetic Person\n\temail = synthetic@example.invalid\n"
            "[credential]\n\thelper = store\n",
        )
        self.commit_tracked(".gitconfig")
        result = self.run_checker()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(".gitconfig:2: git-identity", result.stderr)
        self.assertIn(".gitconfig:3: git-identity", result.stderr)
        self.assertIn(".gitconfig:5: credential-helper-store", result.stderr)
        self.assertNotIn("Synthetic Person", result.stderr)
        self.assertNotIn("synthetic@example.invalid", result.stderr)

    def test_gitconfig_public_sanitized_shape_is_allowed(self) -> None:
        self.write(
            ".gitconfig",
            "[user]\n\tname =\n\temail =\n"
            "[credential]\n\thelper = libsecret\n"
            "[include]\n\tpath = ~/.gitconfig.local\n",
        )
        self.commit_tracked(".gitconfig")
        result = self.run_checker()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_zed_ssh_connections_must_stay_empty(self) -> None:
        self.write(
            ".config/zed/settings.json",
            '{\n  // comments are allowed\n  "ssh_connections": [\n  ]\n}\n',
        )
        self.commit_tracked(".config/zed/settings.json")
        result = self.run_checker()
        self.assertEqual(result.returncode, 0, result.stderr)

        self.write(
            ".config/zed/settings.json",
            '{\n  "ssh_connections": [\n    {"host": "synthetic-host"}\n  ]\n}\n',
        )
        self.git("add", ".config/zed/settings.json")
        result = self.run_checker("--staged")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("zed-ssh-connections", result.stderr)
        self.assertNotIn("synthetic-host", result.stderr)

    def test_binary_png_allowed_only_in_theme_asset_locations(self) -> None:
        png = self.repo / ".config/swaync/icons/icon.png"
        png.parent.mkdir(parents=True)
        png.write_bytes(b"\x89PNG\r\n\x1a\n\0")
        renamed = self.repo / ".config/swaync/icons/renamed.png"
        renamed.write_bytes(b"\x00\x01\x02")
        arbitrary = self.repo / ".config/app/blob.bin"
        arbitrary.parent.mkdir(parents=True)
        arbitrary.write_bytes(b"\x00\x01\x02")
        wrong_location = self.repo / ".config/app/icon.png"
        wrong_location.write_bytes(b"\x89PNG\r\n\x1a\n\0")
        self.commit_tracked(
            ".config/swaync/icons/icon.png",
            ".config/swaync/icons/renamed.png",
            ".config/app/blob.bin",
            ".config/app/icon.png",
        )
        result = self.run_checker()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("swaync/icons/icon.png", result.stderr)
        self.assertIn("swaync/icons/renamed.png", result.stderr)
        self.assertIn(".config/app/icon.png", result.stderr)
        self.assertIn("blob.bin", result.stderr)
        self.assertIn("binary-content", result.stderr)

    def test_oversized_png_and_oversized_text_fail_before_content(self) -> None:
        large = self.repo / ".config/swaync/icons/large.png"
        large.parent.mkdir(parents=True)
        large.write_bytes(b"\x89PNG\r\n\x1a\n" + (b"\0" * (2 * 1024 * 1024 + 1)))
        self.write(".config/app/large.conf", "A" * (2 * 1024 * 1024 + 1))
        self.commit_tracked(".config/swaync/icons/large.png", ".config/app/large.conf")
        result = self.run_checker()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("large.png: oversized-file", result.stderr)
        self.assertIn("large.conf: oversized-file", result.stderr)

    def test_source_symlink_and_denied_path_are_refused_before_read(self) -> None:
        source = Path(self._tmp.name) / "source"
        source.write_text("ordinary\n", encoding="utf-8")
        link = Path(self._tmp.name) / "link"
        link.symlink_to(source)
        result = self.run_checker("--file", ".config/app/test.conf", str(link))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unsafe-source-symlink", result.stderr)

        result = self.run_checker("--file", ".ssh/id_rsa", "/does/not/exist")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("denied-path", result.stderr)
        self.assertNotIn("unreadable-file", result.stderr)

    def test_source_ancestor_symlink_and_credential_source_are_refused(self) -> None:
        base = Path(self._tmp.name) / "base"
        base.mkdir()
        source = base / "payload"
        secret = token("ghp_", 30)
        source.write_text(secret + "\n", encoding="utf-8")
        linkdir = Path(self._tmp.name) / "linkdir"
        linkdir.symlink_to(base)
        result = self.run_checker("--file", ".config/app/test.conf", str(linkdir / "payload"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unsafe-source-symlink", result.stderr)
        self.assertNotIn(secret, result.stderr)

        credential_dir = Path(self._tmp.name) / ".ssh"
        credential_dir.mkdir()
        credential = credential_dir / "payload"
        credential.write_text(secret + "\n", encoding="utf-8")
        result = self.run_checker("--file", ".config/app/test.conf", str(credential))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("denied-path", result.stderr)
        self.assertNotIn(secret, result.stderr)

    def test_relative_symlink_to_forbidden_source_is_rejected_before_read(self) -> None:
        secret = token("ghp_", 30)
        self.write(".ssh/id_rsa", secret + "\n")
        link = self.repo / ".config/app/link"
        link.parent.mkdir(parents=True)
        link.symlink_to("../../.ssh/id_rsa")
        self.commit_tracked(".config/app/link")
        result = self.run_checker()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("denied-path", result.stderr)
        self.assertNotIn(secret, result.stderr)

    def test_worktree_ancestor_symlink_is_rejected_before_read(self) -> None:
        self.write(".config/app/file.conf", "ordinary\n")
        self.commit_tracked(".config/app/file.conf")
        outside = Path(self._tmp.name) / "outside"
        (outside / "app").mkdir(parents=True)
        secret = token("ghp_", 30)
        (outside / "app/file.conf").write_text(secret + "\n", encoding="utf-8")
        shutil.rmtree(self.repo / ".config")
        (self.repo / ".config").symlink_to(outside)
        result = self.run_checker()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unsafe-symlink", result.stderr)
        self.assertNotIn(secret, result.stderr)

    def test_staged_symlink_chains_use_index_only(self) -> None:
        target = self.write(".config/app/target.conf", "ordinary\n")
        link = self.repo / ".config/app/allowed-link"
        link.symlink_to("target.conf")
        self.git("add", ".config/app/target.conf", ".config/app/allowed-link")
        result = self.run_checker("--staged")
        self.assertEqual(result.returncode, 0, result.stderr)

        escape = self.repo / ".config/app/escape-link"
        escape.symlink_to("../../../outside")
        self.git("add", ".config/app/escape-link")
        result = self.run_checker("--staged")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unsafe-symlink", result.stderr)

        cycle_a = self.repo / ".config/app/cycle-a"
        cycle_b = self.repo / ".config/app/cycle-b"
        cycle_a.symlink_to("cycle-b")
        cycle_b.symlink_to("cycle-a")
        self.git("add", ".config/app/cycle-a", ".config/app/cycle-b")
        result = self.run_checker("--staged")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("symlink-cycle", result.stderr)
        self.assertTrue(target.exists())

    def test_staged_symlink_to_denied_or_untracked_target_is_rejected(self) -> None:
        secret = token("ghp_", 30)
        self.write(".ssh/id_rsa", secret + "\n")
        denied_link = self.repo / ".config/app/denied-link"
        denied_link.parent.mkdir(parents=True)
        denied_link.symlink_to("../../.ssh/id_rsa")
        self.git("add", ".config/app/denied-link")
        result = self.run_checker("--staged")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("denied-path", result.stderr)
        self.assertNotIn(secret, result.stderr)

        self.git("reset", "-q", ".config/app/denied-link")
        missing_link = self.repo / ".config/app/missing-link"
        missing_link.symlink_to("missing.conf")
        self.git("add", ".config/app/missing-link")
        result = self.run_checker("--staged")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("untracked-symlink-target", result.stderr)

    def test_staged_gitlink_mode_is_rejected(self) -> None:
        self.write(".config/app/file.conf", "ordinary\n")
        self.commit_tracked(".config/app/file.conf")
        head = self.git("rev-parse", "HEAD").stdout.strip()
        self.git(
            "update-index",
            "--add",
            "--cacheinfo",
            f"160000,{head},.config/app/submodule",
        )
        result = self.run_checker("--staged")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unsupported-index-mode", result.stderr)

    def test_absolute_tracked_symlink_is_not_followed(self) -> None:
        outside = Path(self._tmp.name) / "outside"
        outside.write_text(token("ghp_", 30) + "\n", encoding="utf-8")
        link = self.repo / ".config/app/escape"
        link.parent.mkdir(parents=True)
        link.symlink_to(outside)
        self.commit_tracked(".config/app/escape")
        result = self.run_checker()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unsafe-symlink", result.stderr)
        self.assertNotIn(token("ghp_", 30), result.stderr)

    def test_staged_content_is_checked(self) -> None:
        self.write(".config/app/test.conf", "ordinary\n")
        self.commit_tracked(".config/app/test.conf")
        secret = token("npm_", 30)
        self.write(".config/app/test.conf", f"token={secret}\n")
        self.git("add", ".config/app/test.conf")
        self.write(".config/app/test.conf", "clean worktree\n")
        result = self.run_checker("--staged")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("npm-token", result.stderr)
        self.assertNotIn(secret, result.stderr)


class CaptureTests(RepoCase):
    def test_no_partial_capture_when_one_candidate_fails(self) -> None:
        self.write(".config/app/good.conf", "old good\n")
        self.write(".config/app/bad.conf", "old bad\n")
        self.commit_tracked(".config/app/good.conf", ".config/app/bad.conf")
        self.write_home(".config/app/good.conf", "new good\n")
        secret = token("ghp_", 30)
        self.write_home(".config/app/bad.conf", f"token={secret}\n")

        result = self.run_script("capture.sh")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.repo / ".config/app/good.conf").read_text(), "old good\n")
        self.assertEqual((self.repo / ".config/app/bad.conf").read_text(), "old bad\n")
        self.assertNotIn(secret, result.stdout + result.stderr)

    def test_dry_run_does_not_write(self) -> None:
        self.write(".config/app/test.conf", "old\n")
        self.commit_tracked(".config/app/test.conf")
        self.write_home(".config/app/test.conf", "new\n")
        result = self.run_script("capture.sh", "--dry-run")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.repo / ".config/app/test.conf").read_text(), "old\n")
        self.assertIn("would be updated", result.stdout)

    def test_explicit_untracked_path_is_rejected(self) -> None:
        self.write(".config/app/tracked.conf", "old\n")
        self.write(".config/app/untracked.conf", "old\n")
        self.commit_tracked(".config/app/tracked.conf")
        self.write_home(".config/app/tracked.conf", "new\n")
        self.write_home(".config/app/untracked.conf", "new\n")
        result = self.run_script("capture.sh", ".config/app/untracked.conf")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.repo / ".config/app/untracked.conf").read_text(), "old\n")

    def test_explicit_tracked_path_updates_only_that_path(self) -> None:
        self.write(".config/app/one.conf", "old one\n")
        self.write(".config/app/two.conf", "old two\n")
        self.commit_tracked(".config/app/one.conf", ".config/app/two.conf")
        self.write_home(".config/app/one.conf", "new one\n")
        self.write_home(".config/app/two.conf", "new two\n")
        result = self.run_script("capture.sh", ".config/app/one.conf")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.repo / ".config/app/one.conf").read_text(), "new one\n")
        self.assertEqual((self.repo / ".config/app/two.conf").read_text(), "old two\n")

    def test_examples_and_denied_paths_are_not_captured(self) -> None:
        self.write(".config/app/sample.conf.example", "old\n")
        self.write(".pi/agent/unfinished-work.md", "old\n")
        self.commit_tracked(
            ".config/app/sample.conf.example",
            ".pi/agent/unfinished-work.md",
        )
        self.write_home(".config/app/sample.conf.example", "machine data\n")
        self.write_home(".pi/agent/unfinished-work.md", "private note\n")
        result = self.run_script("capture.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.repo / ".config/app/sample.conf.example").read_text(), "old\n")
        self.assertEqual((self.repo / ".pi/agent/unfinished-work.md").read_text(), "old\n")

    def test_explicit_denied_path_fails_before_write(self) -> None:
        self.write(".pi/agent/unfinished-work.md", "old\n")
        self.commit_tracked(".pi/agent/unfinished-work.md")
        self.write_home(".pi/agent/unfinished-work.md", "private note\n")
        result = self.run_script("capture.sh", ".pi/agent/unfinished-work.md")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.repo / ".pi/agent/unfinished-work.md").read_text(), "old\n")

    def test_live_source_symlink_is_refused(self) -> None:
        self.write(".config/app/test.conf", "old\n")
        self.commit_tracked(".config/app/test.conf")
        source = self.home / ".config/app/real.conf"
        source.parent.mkdir(parents=True)
        source.write_text("new\n", encoding="utf-8")
        (self.home / ".config/app/test.conf").symlink_to(source)
        result = self.run_script("capture.sh")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.repo / ".config/app/test.conf").read_text(), "old\n")
        self.assertIn("unsafe-source-symlink", result.stderr)

    def test_capture_refuses_live_git_identity_before_write(self) -> None:
        self.write(".gitconfig", "[core]\n\teditor = nvim\n")
        self.commit_tracked(".gitconfig")
        identity = "Synthetic Person"
        address = "synthetic@example.invalid"
        self.write_home(
            ".gitconfig",
            "[user]\n\tname = "
            + identity
            + "\n\temail = "
            + address
            + "\n[credential]\n\thelper = store\n",
        )
        result = self.run_script("capture.sh")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.repo / ".gitconfig").read_text(), "[core]\n\teditor = nvim\n")
        self.assertIn("git-identity", result.stderr)
        self.assertIn("credential-helper-store", result.stderr)
        self.assertNotIn(identity, result.stdout + result.stderr)
        self.assertNotIn(address, result.stdout + result.stderr)

    def test_capture_refuses_live_zed_ssh_connections_before_write(self) -> None:
        self.write(".config/zed/settings.json", '{"ssh_connections": []}\n')
        self.commit_tracked(".config/zed/settings.json")
        self.write_home(
            ".config/zed/settings.json",
            '{"ssh_connections": [{"host": "synthetic-host"}]}\n',
        )
        result = self.run_script("capture.sh")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            (self.repo / ".config/zed/settings.json").read_text(),
            '{"ssh_connections": []}\n',
        )
        self.assertIn("zed-ssh-connections", result.stderr)
        self.assertNotIn("synthetic-host", result.stdout + result.stderr)

        self.write_home(".config/zed/settings.json", '{"ssh_connections": []}\n')
        result = self.run_script("capture.sh")
        self.assertEqual(result.returncode, 0, result.stderr)


class InstallTests(RepoCase):
    def test_copies_only_tracked_files_and_skips_examples(self) -> None:
        self.write(".bashrc", "repo bashrc\n")
        self.write(".config/app/real.conf", "real\n")
        self.write(".config/app/template.conf.example", "template\n")
        self.write(".config/app/local-note.md", "untracked local\n")
        self.commit_tracked(".bashrc", ".config/app/real.conf", ".config/app/template.conf.example")
        result = self.run_script("install.sh", "--no-deps")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.home / ".bashrc").read_text(), "repo bashrc\n")
        self.assertEqual((self.home / ".config/app/real.conf").read_text(), "real\n")
        self.assertFalse((self.home / ".config/app/template.conf.example").exists())
        self.assertFalse((self.home / ".config/app/local-note.md").exists())

    def test_denied_credential_paths_are_not_installed(self) -> None:
        self.write(".netrc", "machine example.invalid\n")
        self.write(".pi/agent/auth.json", "{}\n")
        self.commit_tracked(".netrc", ".pi/agent/auth.json")
        result = self.run_script("install.sh", "--no-deps")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.home / ".netrc").exists())
        self.assertFalse((self.home / ".pi/agent/auth.json").exists())

    def test_copy_backs_up_and_is_idempotent(self) -> None:
        source = self.write(".bashrc", "new\n", mode=0o644)
        self.commit_tracked(".bashrc")
        self.write_home(".bashrc", "old\n")
        result = self.run_script("install.sh", "--no-deps")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.home / ".bashrc").read_text(), "new\n")
        backups = list(self.home.glob(".dotfiles-backup-*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(stat.S_IMODE(backups[0].stat().st_mode), 0o700)
        self.assertEqual((backups[0] / ".bashrc").read_text(), "old\n")
        self.assertEqual(stat.S_IMODE(source.stat().st_mode), 0o644)

        result = self.run_script("install.sh", "--no-deps")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(list(self.home.glob(".dotfiles-backup-*"))), 1)

    def test_private_file_mode_is_set_on_destination(self) -> None:
        self.write(".npmrc", "prefix=${HOME}/.npm-global\n")
        self.commit_tracked(".npmrc")
        result = self.run_script("install.sh", "--no-deps")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(stat.S_IMODE((self.home / ".npmrc").stat().st_mode), 0o600)

    def test_link_mode_links_files_not_directories(self) -> None:
        self.write(".config/app/a.conf", "a\n")
        self.write(".config/app/b.conf", "b\n")
        self.write(".config/app/local.md", "local\n")
        self.commit_tracked(".config/app/a.conf", ".config/app/b.conf")
        result = self.run_script("install.sh", "--link", "--no-deps")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.home / ".config").is_dir())
        self.assertFalse((self.home / ".config").is_symlink())
        self.assertTrue((self.home / ".config/app/a.conf").is_symlink())
        self.assertTrue((self.home / ".config/app/b.conf").is_symlink())
        self.assertFalse((self.home / ".config/app/local.md").exists())

    def test_link_force_backs_up_and_is_idempotent(self) -> None:
        self.write(".config/app/a.conf", "new\n")
        self.commit_tracked(".config/app/a.conf")
        self.write_home(".config/app/a.conf", "old\n")
        result = self.run_script("install.sh", "--link", "--force", "--no-deps")
        self.assertEqual(result.returncode, 0, result.stderr)
        target = self.home / ".config/app/a.conf"
        self.assertEqual(target.resolve(), (self.repo / ".config/app/a.conf").resolve())
        backups = list(self.home.glob(".dotfiles-backup-*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual((backups[0] / ".config/app/a.conf").read_text(), "old\n")

        result = self.run_script("install.sh", "--link", "--force", "--no-deps")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(list(self.home.glob(".dotfiles-backup-*"))), 1)

    def test_dry_run_does_not_write_or_back_up(self) -> None:
        self.write(".bashrc", "new\n")
        self.commit_tracked(".bashrc")
        self.write_home(".bashrc", "old\n")
        result = self.run_script("install.sh", "--dry-run", "--no-deps")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.home / ".bashrc").read_text(), "old\n")
        self.assertEqual(list(self.home.glob(".dotfiles-backup-*")), [])

    def test_ancestor_symlink_is_refused(self) -> None:
        self.write(".config/app/a.conf", "new\n")
        self.commit_tracked(".config/app/a.conf")
        outside = Path(self._tmp.name) / "outside"
        outside.mkdir()
        (self.home / ".config").symlink_to(outside)
        result = self.run_script("install.sh", "--no-deps")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((outside / "app/a.conf").exists())

    def test_custom_npm_failure_is_nonzero(self) -> None:
        self.write(
            ".pi/agent/packages/demo/package.json",
            '{"name":"demo","version":"1.0.0","dependencies":{"dep":"1.0.0"}}\n',
        )
        self.commit_tracked(".pi/agent/packages/demo/package.json")
        fakebin = Path(self._tmp.name) / "bin"
        fakebin.mkdir()
        marker = Path(self._tmp.name) / "npm-ran"
        npm = fakebin / "npm"
        npm.write_text(f"#!/bin/sh\ntouch '{marker}'\nexit 7\n", encoding="utf-8")
        npm.chmod(0o755)

        result = self.run_script(
            "install.sh",
            "--no-deps",
            env={"PATH": f"{fakebin}:{self.env['PATH']}"},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(marker.exists())

        result = self.run_script(
            "install.sh",
            env={"PATH": f"{fakebin}:{self.env['PATH']}"},
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(marker.exists())
        self.assertIn("npm install failed", result.stderr)


class PiCheckTests(RepoCase):
    def _write_pi_fixture(self) -> None:
        self.write(".pi/agent/settings.json", '{"name":"test"}\n')
        self.write(".pi/agent/extensions/example.ts", "export const value = 1;\n")
        self.write(".pi/agent/extensions/lib/helper.ts", "export const helper = 1;\n")
        self.write(
            ".pi/agent/extensions/use-helper.ts",
            "import { helper } from './lib/helper.ts';\n",
        )
        self.commit_tracked(
            ".pi/agent/settings.json",
            ".pi/agent/extensions/example.ts",
            ".pi/agent/extensions/lib/helper.ts",
            ".pi/agent/extensions/use-helper.ts",
        )

    def test_untracked_private_files_are_ignored(self) -> None:
        self._write_pi_fixture()
        self.write(".pi/agent/unfinished-work.md", "private local note\n")
        self.write(".pi/agent/auth.json", "{}\n")
        self.write(".pi/agent/extensions/private-untracked.ts", "bad import 'x'\n")
        result = self.run_script("check-pi-extension-imports.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("passed", result.stdout)

    def test_tracked_forbidden_path_fails_via_validator(self) -> None:
        self._write_pi_fixture()
        self.write(".pi/agent/unfinished-work.md", "private note\n")
        self.commit_tracked(".pi/agent/unfinished-work.md")
        result = self.run_script("check-pi-extension-imports.sh")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(".pi/agent/unfinished-work.md", result.stderr)


if __name__ == "__main__":
    unittest.main()
