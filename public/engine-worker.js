/* Runs the Python engine (engine/*.py, copied to /engine-py/) inside the browser with Pyodide.
 * The uploaded CSV files never leave the visitor's computer: they are checked and analysed here.
 *
 * in:  { type: "run", base, files: { inventory: ArrayBuffer, metrics: ArrayBuffer, pricing: ArrayBuffer, rates?: ArrayBuffer }, name }
 * out: { type: "progress", step, detail } ... then { type: "problems", problems } or { type: "done", outputs } or { type: "crash", message }
 */
let pyodide = null;

const post = (m) => self.postMessage(m);

async function boot(base) {
  if (pyodide) return pyodide;
  post({ type: "progress", step: "boot", detail: "Downloading the Python engine (about 15 MB, cached after the first time)" });
  importScripts(base + "pyodide.js");
  pyodide = await self.loadPyodide({ indexURL: base, stdout: (line) => post({ type: "progress", step: "log", detail: line }), stderr: () => {} });
  await pyodide.loadPackage(["numpy", "pandas"], { messageCallback: () => {}, errorCallback: () => {} });
  const files = await (await fetch("/engine-py/manifest.json", { cache: "no-store" })).json();
  pyodide.FS.mkdirTree("/engine");
  for (const f of files) {
    const text = await (await fetch(`/engine-py/${f}`, { cache: "no-store" })).text();
    pyodide.FS.writeFile(`/engine/${f}`, text);
  }
  return pyodide;
}

const RUN = `
import json, os, shutil, sys
from pathlib import Path

sys.path.insert(0, "/engine")
for m in ["config", "generate", "stats", "recommend", "alerts", "forecast", "target", "build"]:
    sys.modules.pop(m, None)          # a second upload must re-read the new dataset.json
import csv_loader

def _run(name):
    for d in ("/work", "/out"):
        shutil.rmtree(d, ignore_errors=True)
    files = {p.stem: p.read_bytes() for p in Path("/upload").glob("*.csv")}
    try:
        res = csv_loader.load(files, name)
    except csv_loader.CSVError as e:
        return json.dumps({"ok": False, "problems": e.problems})
    csv_loader.write(Path("/work"), *res)
    os.environ["SMARTCLOUD_DATA_DIR"] = "/work"
    os.environ["SMARTCLOUD_OUT_DIR"] = "/out"
    print("STEP engine")
    import build
    build.main()
    return json.dumps({"ok": True})
`;

self.onmessage = async (e) => {
  const { type, base, files, name } = e.data;
  if (type !== "run") return;
  try {
    const py = await boot(base);
    post({ type: "progress", step: "check", detail: "Checking every file, row and column" });
    py.FS.mkdirTree("/upload");
    for (const f of py.FS.readdir("/upload")) if (f.endsWith(".csv")) py.FS.unlink(`/upload/${f}`);
    for (const [k, buf] of Object.entries(files)) py.FS.writeFile(`/upload/${k}.csv`, new Uint8Array(buf));
    py.runPython(RUN);
    const res = JSON.parse(py.globals.get("_run")(name || "Uploaded data"));
    if (!res.ok) return post({ type: "problems", problems: res.problems });

    post({ type: "progress", step: "save", detail: "Preparing the dashboard" });
    const read = (p) => JSON.parse(py.FS.readFile(p, { encoding: "utf8" }));
    const outputs = {};
    for (const n of ["summary", "resources", "recommendations", "alerts", "forecast", "assumptions", "fleet", "fleet_cells"]) outputs[n] = read(`/out/${n}.json`);
    outputs.series = {};
    for (const f of py.FS.readdir("/out/series")) if (f.endsWith(".json")) outputs.series[f.slice(0, -5)] = read(`/out/series/${f}`);
    post({ type: "done", outputs });
  } catch (err) {
    post({ type: "crash", message: String(err && err.message ? err.message : err).slice(-1500) });
  }
};
