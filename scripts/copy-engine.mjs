// Copies the Python engine into public/engine-py/ so the Upload real data page can run the very same code in
// the browser (Pyodide). Runs before `next dev` and `next build`; the copy is not committed.
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "engine");
const out = join(root, "public", "engine-py");
const SKIP = new Set(["export_csv.py", "make_sample_csv.py"]);   // command-line only

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const files = readdirSync(src).filter((f) => f.endsWith(".py") && !SKIP.has(f)).sort();
for (const f of files) copyFileSync(join(src, f), join(out, f));
writeFileSync(join(out, "manifest.json"), JSON.stringify(files));
console.log(`engine-py: ${files.length} files`);
