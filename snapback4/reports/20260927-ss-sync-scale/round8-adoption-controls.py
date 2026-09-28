#!/usr/bin/env python3
"""Reconstruct the isolated, interleaved timing controls; never run the suite.

Run from snapback4 with the pinned Node/Bun on PATH after the normal package
build. All generated files remain under this worktree's ignored target/.
The only test instrumentation prints elapsed time before the original bound.
"""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SDK = ROOT / "packages/snapback4"
OUT = ROOT / "target/lane-ss-round8/adoption-replay"
BASE = "1366c700c"
SOURCES = ("device-control.ts", "device-restore.ts", "local-device.ts", "local.ts",
           "web-worker-device.ts", "web-worker-host.ts", "web-ownership.ts")
OUT.mkdir(parents=True, exist_ok=True)
original = (SDK / "test/ephemeral-adoption.test.mjs").read_text()
needle = "assert.ok(performance.now() - began <= 500);"
assert original.count(needle) == 1
instrumented = original.replace(needle, 'console.info("ADOPTION_ELAPSED_MS", performance.now() - began); ' + needle)
for mode in ("baseline", "current"):
    dst = OUT / mode
    dst.mkdir(exist_ok=True)
    for name in ("src", "dist"):
        shutil.copytree(SDK / name, dst / name, dirs_exist_ok=True)
    for name in ("package.json", "tsconfig.json", "tsconfig.build.json"):
        shutil.copy2(SDK / name, dst / name)
    if not (dst / "node_modules").exists():
        (dst / "node_modules").symlink_to(SDK / "node_modules", target_is_directory=True)
    (dst / "test").mkdir(exist_ok=True)
    shutil.copytree(SDK / "test/helpers", dst / "test/helpers", dirs_exist_ok=True)
    (dst / "test/ephemeral-adoption.test.mjs").write_text(instrumented)
    if mode == "baseline":
        for name in SOURCES:
            (dst / "src" / name).write_bytes(subprocess.check_output(
                ["git", "show", f"{BASE}:snapback4/packages/snapback4/src/{name}"], cwd=ROOT))
        with (OUT / "baseline-build.log").open("w") as log:
            subprocess.run(["bun", "run", "build"], cwd=dst, stdout=log, stderr=subprocess.STDOUT, check=True)

results = []
env = {**os.environ, "SNAPBACK4_BIN": str(ROOT / "target/debug/snapback4")}
for iteration in range(1, 4):
    for mode in ("baseline", "current"):
        command = ["node", "--test", "--test-name-pattern=^wasm: adoption replaces mounted ephemeral interests, including removal$",
                   str(OUT / mode / "test/ephemeral-adoption.test.mjs")]
        run = subprocess.run(command, cwd=ROOT, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        log = f"{mode}-{iteration}.log"
        (OUT / log).write_text(run.stdout)
        row = {"mode": mode, "iteration": iteration, "exit": run.returncode, "log": log, "output": run.stdout}
        results.append(row)
        print(json.dumps(row), flush=True)
(OUT / "controls.json").write_text(json.dumps({"baselineCommit": BASE,
    "instrumentation": "elapsed logging before unchanged <=500ms assertion",
    "originalTestSHA256": hashlib.sha256(original.encode()).hexdigest(), "results": results}, indent=2) + "\n")
