// Runs the Python engine from npm on any OS: `npm run data`, `npm run data:csv -- <folder>`, `npm run test:engine`.
// Finds a working Python 3 (python3, python, or the Windows `py` launcher) and works in both folder layouts:
// the GitHub repo (engine/ next to package.json) and the 3-folder copy (../2_data_collection_and_analysis).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const flat = existsSync(join(root, "engine", "build.py"));
const data = flat ? join(root, "engine") : join(root, "..", "2_data_collection_and_analysis");
const tests = flat ? [join(data, "tests")] : [join(root, "..", "3_recommendation_engine", "tests"), join(data, "tests")];

const candidates = [["python3"], ["python"], ["py", "-3"]];
const py = candidates.find(([cmd, ...pre]) => {
  const r = spawnSync(cmd, [...pre, "--version"], { encoding: "utf8" });
  return r.status === 0 && /Python 3/.test(r.stdout + r.stderr);
});
if (!py) {
  console.error("Python 3 not found. Install it from https://www.python.org/downloads/ (tick \"Add to PATH\"), then run:");
  console.error(`  pip install -r ${join(data, "requirements.txt")}`);
  process.exit(1);
}

function run(...args) {
  const [cmd, ...pre] = py;
  const r = spawnSync(cmd, [...pre, ...args], { stdio: "inherit", cwd: data });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const [task, ...rest] = process.argv.slice(2);
if (task === "data") {
  run("generate.py");
  run("build.py");
} else if (task === "csv") {
  if (!rest.length) {
    console.error("usage: npm run data:csv -- <folder with inventory.csv, metrics.csv, pricing.csv>");
    process.exit(1);
  }
  run("build.py", "--data", resolve(process.env.INIT_CWD || process.cwd(), rest[0]));
} else if (task === "test") {
  run("-m", "pytest", "-q", ...tests);
} else {
  console.error("usage: node scripts/engine.mjs data | csv <folder> | test");
  process.exit(1);
}
