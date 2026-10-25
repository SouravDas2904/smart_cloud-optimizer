// Copies the Python engine into public/engine-py/ so the Upload real data page can run the very same code in
// the browser (Pyodide). Runs before `next dev` and `next build`; the copy is not committed.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "engine");
const out = join(root, "public", "engine-py");
const SKIP = new Set(["export_csv.py", "make_sample_csv.py"]);   // command-line only
// The worker imports these; a build without them would ship a broken Upload page, so fail the build instead.
const NEEDED = ["build.py", "config.py", "csv_loader.py", "recommend.py", "stats.py"];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const files = existsSync(src) ? readdirSync(src).filter((f) => f.endsWith(".py") && !SKIP.has(f)).sort() : [];
const missing = NEEDED.filter((f) => !files.includes(f));
if (missing.length) {
  console.error(`engine-py: missing ${missing.join(", ")} in ${src}. Is engine/ excluded from the deployment (.vercelignore)?`);
  process.exit(1);
}
for (const f of files) copyFileSync(join(src, f), join(out, f));
writeFileSync(join(out, "manifest.json"), JSON.stringify(files));
console.log(`engine-py: ${files.length} files`);
