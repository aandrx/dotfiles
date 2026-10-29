"""Exercise the usage wrapper with synthetic authentication and no network."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(shutil.which("node"), "Node is required for the wrapper test")
class UsagePrivacyTests(unittest.TestCase):
    def test_credential_is_not_a_process_argument(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            agent = base / "agent"
            install = base / "install"
            module = install / "node_modules/jiti/lib/jiti-static.mjs"
            usage = agent / "npm/node_modules/pi-ollama-cloud/usage.ts"
            usage.parent.mkdir(parents=True)
            module.parent.mkdir(parents=True)
            credential = "synthetic-" + "credential-for-unit-test"
            (agent / "auth.json").write_text(json.dumps({"ollama-cloud": {"key": credential}}))
            usage.write_text("// The fake loader supplies the implementation.\n")
            module.write_text("""
export function createJiti() {
  return { import: async () => ({
    fetchUsage: async (key) => {
      if (!key.startsWith('synthetic-')) throw new Error('credential not passed');
      if (process.argv.some(arg => arg.includes(key))) throw new Error('credential exposed');
      return { ok: true };
    },
    formatUsage: data => data.ok ? 'usage-ok' : 'usage-failed'
  }) };
}
""")
            env = dict(os.environ, PI_CODING_AGENT_DIR=str(agent), PI_ROOT=str(install))
            result = subprocess.run(["bash", str(ROOT / "bin/ollama-cloud-usage")],
                                    env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), "usage-ok")
            self.assertNotIn(credential, result.stdout + result.stderr)
            (agent / "auth.json").write_text("not valid json")
            result = subprocess.run(["bash", str(ROOT / "bin/ollama-cloud-usage")],
                                    env=env, text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn(credential, result.stdout + result.stderr)
            self.assertIn("Could not load", result.stderr)


if __name__ == "__main__":
    unittest.main()
