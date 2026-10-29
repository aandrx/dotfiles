"""Verify public service defaults without contacting any service or loading Pi."""
import os
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]
NODE = shutil.which("node")
try:
    NODE_MAJOR = int(subprocess.check_output([NODE, "--version"], text=True).lstrip("v").split(".")[0]) if NODE else 0
except (OSError, ValueError, subprocess.CalledProcessError):
    NODE_MAJOR = 0


@unittest.skipUnless(NODE_MAJOR >= 22, "Native TypeScript loading requires Node 22+")
class PortableEndpointTests(unittest.TestCase):
    def test_defaults_and_environment_overrides_without_network(self):
        source = r"""
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const root = process.argv[1];
for (const [file, variable, fallback, toolName, params, body] of [
  ['searxng-search.ts', 'SEARXNG_URL', 'http://localhost:8888', 'searxng_web_search', {query:'test'}, {results:[]}],
  ['ruepi-web-extract.ts', 'SELFHOSTED_EXTRACT_URL', 'http://localhost:8899', 'ruepi_web_extract', {urls:['https://example.org/']},
    {results:[{ok:false,requested_url:'https://example.org/',error:'fetch failed or exceeded limits'}]}],
]) {
  const mod = await import(pathToFileURL(`${root}/.pi/agent/extensions/${file}`).href);
  let tool;
  mod.default({registerTool(value) {tool = value;}});
  assert.equal(tool.name, toolName);
  for (const endpoint of [null, 'https://service.example.org']) {
    if (endpoint === null) delete process.env[variable]; else process.env[variable] = endpoint;
    let requestCount = 0;
    globalThis.fetch = async (url) => {
      requestCount++;
      assert.ok(String(url).startsWith(endpoint ?? fallback), 'unexpected endpoint');
      return new Response(JSON.stringify(body), {headers:{'content-type':'application/json'}});
    };
    await tool.execute('isolated-test', params);
    assert.equal(requestCount, 1);
  }
}
"""
        env = dict(os.environ)
        env.pop("SEARXNG_URL", None)
        env.pop("SELFHOSTED_EXTRACT_URL", None)
        result = subprocess.run([NODE, "--experimental-strip-types", "--input-type=module", "-e", source, str(ROOT)],
                                text=True, capture_output=True, env=env)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
