import { readdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(p);
      continue;
    }
    if (e.isFile() && p.endsWith(".js")) {
      const next = p.slice(0, -3) + ".cjs";
      await rename(p, next);
    }
  }
}

async function main() {
  const dir = fileURLToPath(new URL("../dist/cjs", import.meta.url));
  try {
    const s = await stat(dir);
    if (!s.isDirectory()) return;
  } catch {
    return;
  }
  await walk(dir);
}

main();


