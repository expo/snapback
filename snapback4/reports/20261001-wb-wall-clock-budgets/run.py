"""Run one whole suite, retaining its output and only reaping our own workers.

Usage: python3 reports/20261001-wb-wall-clock-budgets/run.py NAME WORKERS [slow|unconfined]
An optional -- COMMAND... runs a named diagnostic control instead.
Build busy into target/wb-load before use. No suite override,
seed override, runtime limit or scheduler priority adjustment is supplied.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

root = Path(os.environ.get("WB_RUN_ROOT", Path(__file__).resolve().parents[2]))
report = Path(__file__).resolve().parent
name, workers = sys.argv[1], int(sys.argv[2])
remaining = sys.argv[3:]
mode = remaining.pop(0) if remaining and remaining[0] != "--" else "load"
assert mode in ("load", "slow", "unconfined"), mode
if remaining:
    assert remaining.pop(0) == "--" and remaining, "use -- COMMAND for a diagnostic control"
command = remaining or ["bash", "scripts/test.sh"]
cpu_range = os.environ.get("WB_CPUS", "86-95")
low, high = map(int, cpu_range.split("-"))
assert high - low == 9
affinity = [] if mode == "unconfined" else ["taskset", "-c", cpu_range]
env = dict(os.environ, LIBSQLITE3_FLAGS="-USQLITE_ENABLE_MEMORY_MANAGEMENT")
for key in ("SNAPBACK4_RUST_TEST_PROCESSES", "SNAPBACK4_TEST_SERIAL_CLIENT_FILES", "SNAPBACK4_BIN"):
    env.pop(key, None)
# Whole runs must use the published defaults, without focused controls/seeds.
count_keys = ("SNAPBACK4_SESSION_SEQUENCES", "SNAPBACK4_ONLINE_SEQUENCES", "RL_SEEDS",
              "SNAPBACK4_WEB_ADMISSION_FOCUS", "SNAPBACK4_CLIQUE_FULL", "SB4_SEARCH_SEEDS")
if command == ["bash", "scripts/test.sh"]:
    assert all(key not in env for key in count_keys), "remove inherited test overrides"
guard = [] if mode == "unconfined" else [str(root / "target/wb-load/confine")]
wrapper = []
if mode == "slow":
    wrapper = [str(root / "target/wb-load/slow-exec"), "300", str(report / f"{name}-exec.log")]
meta = {
    "name": name, "workers": workers, "mode": mode, "affinity": affinity, "guard": guard, "wrapper": wrapper, "command": command,
    "harness_sha256": {name: hashlib.sha256((root / "target/wb-load" / name).read_bytes()).hexdigest() for name in (["confine", "busy"] + (["slow-exec"] if mode == "slow" else []))},
    "start": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
    "diff_sha256": hashlib.sha256(subprocess.check_output(["git", "diff"], cwd=root)).hexdigest(),
    "tested_diff_sha256": hashlib.sha256(subprocess.check_output([
        "git", "diff", "--", "crates", "packages", "scripts", "witness", "fixtures",
        "Cargo.toml", "Cargo.lock", "bun.lock"], cwd=root)).hexdigest(),
    "test_overrides": {key: env.get(key) for key in count_keys},
    "inputs": {key: env.get(key) for key in (
        "CARGO_TARGET_DIR", "CARGO_BUILD_JOBS", "RUSTFLAGS", "RUSTUP_TOOLCHAIN",
        "CARGO_PROFILE_DEV_DEBUG", "CARGO_PROFILE_TEST_DEBUG", "LIBSQLITE3_FLAGS")},
}
manifest_name = os.environ.get("WB_MANIFEST", "source-manifest.json")
def source_manifest():
    expected = json.loads((report / manifest_name).read_text())
    return {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in expected}
meta["source_manifest"] = source_manifest()
assert meta["source_manifest"] == json.loads((report / manifest_name).read_text())
started = time.monotonic()
load = []
suite = None
try:
    for _ in range(workers):
        load.append(subprocess.Popen(["taskset", "-c", cpu_range, str(root / "target/wb-load/confine"), str(root / "target/wb-load/busy")]))
    # Read back after taskset has executed, not during the fork/exec transition.
    for p in load:
        end = time.monotonic() + 5
        while os.sched_getaffinity(p.pid) != set(range(low, high + 1)):
            assert p.poll() is None and time.monotonic() < end, "load affinity was not installed"
            time.sleep(0.01)
    meta["load_pids"] = [p.pid for p in load]
    meta["load_affinity"] = {str(p.pid): sorted(os.sched_getaffinity(p.pid)) for p in load}
    (report / f"{name}.json").write_text(json.dumps(meta, indent=2) + "\n")
    with (report / f"{name}.log").open("w") as log:
        suite = subprocess.Popen(affinity + guard + wrapper + command, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
        meta["suite_pid"] = suite.pid
        (report / f"{name}.json").write_text(json.dumps(meta, indent=2) + "\n")
        meta["exit"] = suite.wait()
except BaseException:
    if suite is not None and suite.poll() is None:
        suite.terminate()
        suite.wait()
    raise
finally:
    # Retain evidence that the requested busy population survived the whole run.
    meta["load_completion"] = []
    for p in load:
        alive = p.poll() is None
        record = {"pid": p.pid, "alive_before_stop": alive}
        if alive:
            try:
                fields = Path(f"/proc/{p.pid}/stat").read_text().rsplit(")", 1)[1].split()
                record["cpu_seconds"] = (int(fields[11]) + int(fields[12])) / os.sysconf("SC_CLK_TCK")
            except OSError as error:
                record["alive_before_stop"] = False
                record["stats_error"] = str(error)
        meta["load_completion"].append(record)
    if any(not record["alive_before_stop"] for record in meta["load_completion"]):
        meta["harness_failure"] = "a requested busy worker exited before suite completion"
        if meta.get("exit") == 0:
            meta["exit"] = 125
    for p in load:
        p.terminate()
    for p in load:
        p.wait()
    meta["tested_diff_sha256_after"] = hashlib.sha256(subprocess.check_output([
        "git", "diff", "--", "crates", "packages", "scripts", "witness", "fixtures",
        "Cargo.toml", "Cargo.lock", "bun.lock"], cwd=root)).hexdigest()
    if meta["tested_diff_sha256_after"] != meta["tested_diff_sha256"]:
        meta["source_changed_during_run"] = True
        if meta.get("exit") == 0:
            meta["exit"] = 125
    meta["source_manifest_after"] = source_manifest()
    assert meta["source_manifest_after"] == meta["source_manifest"], "source changed during run"
    meta["elapsed_seconds"] = time.monotonic() - started
    meta["end"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (report / f"{name}.json").write_text(json.dumps(meta, indent=2) + "\n")
print(f"{name}: exit={meta.get('exit', 1)} elapsed={meta['elapsed_seconds']:.1f}s log={report / (name + '.log')}")
sys.exit(meta.get("exit", 1))
