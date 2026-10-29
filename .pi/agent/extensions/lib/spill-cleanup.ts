import * as fs from "node:fs";
import * as path from "node:path";

export function sweepSpillRoot(root: string, ttlDays = 30, now = Date.now()): void {
  if (ttlDays === 0) return;
  const rootReal = path.resolve(root);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || rootStat.uid !== process.getuid?.()) return;
  const cutoff = now - ttlDays * 86400000;
  for (const entry of fs.readdirSync(root)) {
    const dir = path.join(root, entry);
    const ds = fs.lstatSync(dir);
    if (ds.isSymbolicLink() || !ds.isDirectory() || ds.uid !== process.getuid?.()) continue;
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      const st = fs.lstatSync(file);
      if (!st.isSymbolicLink() && st.isFile() && st.uid === process.getuid?.() && st.mtimeMs < cutoff) fs.unlinkSync(file);
    }
    if (fs.readdirSync(dir).length === 0 && path.resolve(dir).startsWith(rootReal + path.sep)) fs.rmdirSync(dir);
  }
}
