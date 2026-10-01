"""Scratch-only before/after controls. Run from snapback4; no checkout product is edited."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import difflib, hashlib, json, os, shutil, subprocess, tempfile, time

report = Path(__file__).resolve().parent
root = report.parents[2]
repo = root.parent
base = "33b412a54baf80d170cf197b65f6eda0ea7df2b9"  # reviewed round 0
scratch = Path(tempfile.mkdtemp(prefix="wb-r1-controls-"))

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def run(kind, revision):
    name = f"{kind}-{revision}"
    tree = scratch / name / "snapback4"
    package = tree / "packages/snapback4"
    test = package / "test"
    test.mkdir(parents=True)
    (test / "helpers").mkdir()
    shutil.copy2(root / "packages/snapback4/test/helpers/wait.mjs", test / "helpers/wait.mjs")
    shutil.copytree(root / "packages/snapback4/dist", package / "dist")
    shutil.copy2(root / "packages/snapback4/package.json", package / "package.json")
    (package / "src").symlink_to(root / "packages/snapback4/src", target_is_directory=True)
    (tree / "node_modules").symlink_to(root / "node_modules", target_is_directory=True)
    (tree / "target").mkdir()
    (tree / "target/debug").mkdir()
    (tree / "target/debug/snapback4").symlink_to(root / "target/debug/snapback4")
    filename = {"refresh": "presence-refresh", "slow-reader": "http-bounds", "live-interval": "presence-live"}[kind] + ".test.mjs"
    original = (root / "packages/snapback4/test" / filename).read_text() if revision == "round1" else subprocess.check_output(
        ["git", "show", f"{base}:snapback4/packages/snapback4/test/{filename}"], cwd=repo, text=True)
    source = original
    product = package / "dist/presence-refresh.js"
    product_before = product.read_text()
    if kind in ("refresh", "live-interval"):
        old = "Math.min(Math.max(after, PRESENCE_REFRESH_FLOOR_MS), TIMER_CEILING_MS)"
        assert product_before.count(old) == 1
        extra = "(firstRefresh ? (firstRefresh = false, 4000) : 0)" if kind == "refresh" else "4000"
        product_after = ("let firstRefresh = true;\n" if kind == "refresh" else "") + product_before.replace(old, f"{old} + {extra}")
        product.write_text(product_after)
        patch = ''.join(difflib.unified_diff(product_before.splitlines(True), product_after.splitlines(True), fromfile="dist/presence-refresh.js", tofile="dist/presence-refresh.js"))
    else:
        # Reset only the measurement window in round0, before this request. Both
        # versions log the actual completed /sync sample before any assertions.
        marker = '    await t.test("a paused large response releases the engine before network progress", async () => {\n'
        assert source.count(marker) == 1
        if revision == "round0":
            source = source.replace(marker, marker + '      await (await post("/dev/latency/reset", "{}")).json();\n')
        at = source.rindex('        await ping();')
        source = source[:at] + source[at:].replace('        await ping();', '        await sleep(6500); // scratch control: outlive the write timeout\n        await ping();\n        console.log("CONTROL_COMPLETION", JSON.stringify((await (await fetch(url + "/dev/latency", { headers })).json()).operations["/sync"]));', 1)
        patch = ''.join(difflib.unified_diff(original.splitlines(True), source.splitlines(True), fromfile=filename, tofile=filename))
    (test / filename).write_text(source)
    (report / f"{name}.diff").write_text(patch)
    inputs = {str(path.relative_to(tree)): digest(path) for path in [test / filename, test / "helpers/wait.mjs", product, tree / "target/debug/snapback4"]}
    command = ["node", "--test", f"packages/snapback4/test/{filename}"]
    started = time.monotonic()
    with (report / f"{name}.log").open("w") as log:
        result = subprocess.run(command, cwd=tree, stdout=log, stderr=subprocess.STDOUT)
    record = {"control": kind, "revision": revision, "base": base, "scratch": str(tree), "command": command, "exit": result.returncode,
              "elapsed_seconds": time.monotonic() - started, "inputs": inputs, "original_test_sha256": hashlib.sha256(original.encode()).hexdigest(),
              "product_before_sha256": hashlib.sha256(product_before.encode()).hexdigest(), "log_sha256": digest(report / f"{name}.log")}
    (report / f"{name}.json").write_text(json.dumps(record, indent=2) + "\n")
    print(name, result.returncode, flush=True)
    # Restore the disposable product too; preserve mutations as report patches.
    product.write_text(product_before)
    return record

if __name__ == "__main__":
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(run, kind, revision) for kind in ("refresh", "slow-reader", "live-interval") for revision in ("round0", "round1")]
        records = [future.result() for future in futures]
    (report / "controls.json").write_text(json.dumps(records, indent=2) + "\n")
    assert all(r["exit"] == (0 if r["revision"] == "round0" else 1) for r in records), records
