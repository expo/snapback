"""Validate the completed final matrix; never treat a partial run as a pass.

Run after the final matrix records all requested cells. Optional arguments name
the matrix and source-receipt JSON files in this directory. This reads
existing evidence only and writes qualification.json; it executes no tests.
"""
import hashlib
import json
from pathlib import Path
import re
import sys

report = Path(__file__).resolve().parent


def read(name):
    return json.loads((report / name).read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


matrix_name = sys.argv[1] if len(sys.argv) > 1 else "route-drain-final-matrix.json"
source_name = sys.argv[2] if len(sys.argv) > 2 else "route-drain-source-change.json"
matrix = read(matrix_name)
source = read(source_name)["tested_diff_sha256"]
assert matrix["source"] == source
heavy = matrix["heavy_passes"]
assert len(heavy) == len(set(heavy)) == 3, "three distinct whole heavy passes required"
names = heavy + ["qualified-slow-3", "guide-full", "final-unconfined"]
attempts = {a["name"]: a for a in matrix["attempts"]}
result = {"matrix": matrix_name, "source_receipt": source_name, "tested_diff_sha256": source, "heavy_passes": heavy, "runs": []}
for name in names:
    meta = read(f"{name}.json")
    summary = read(f"{name}.summary.json")
    assert name in attempts and attempts[name]["exit"] == meta["exit"] == 0, name
    assert meta.get("end") and not meta.get("harness_failure"), name
    assert not meta.get("source_changed_during_run"), name
    assert meta["tested_diff_sha256"] == meta["tested_diff_sha256_after"] == source, name
    assert not summary["failures"] and not summary["asynchronous_errors"], name
    assert summary["sha256"] == digest(report / f"{name}.log"), name
    assert all(value is None for value in meta["test_overrides"].values()), name
    if name == "final-unconfined":
        assert meta["mode"] == "unconfined" and meta["workers"] == 0, name
        assert not meta["affinity"] and not meta["guard"] and not meta["wrapper"], name
    else:
        assert meta["affinity"] == ["taskset", "-c", "80-95"] and meta["guard"], name
    if name in heavy:
        assert meta["mode"] == "load" and meta["workers"] == 48, name
        assert len(meta["load_completion"]) == len(meta["load_affinity"]) == 48, name
        assert all(mask == list(range(80, 96)) for mask in meta["load_affinity"].values()), name
        assert all(w["alive_before_stop"] and w["cpu_seconds"] > 0 for w in meta["load_completion"]), name
    else:
        assert meta["workers"] == 0 and not meta["load_completion"], name
    if name == "guide-full":
        assert meta["command"] == ["cargo", "test", "-p", "snapback4-lang", "--test", "guide", "--", "--test-threads=4"], name
        assert summary["rust"] == {"passed": 99, "failed": 0, "ignored": 0}, name
    else:
        assert meta["command"] == ["bash", "scripts/test.sh"], name
        cpus, rust_slots, client_slots = (96, 24, 24) if name == "final-unconfined" else (16, 16, 5)
        assert summary["inventory"] == [
            f"-- rust inventory: 274 test binaries, 987 executions; at most {rust_slots} concurrent processes",
            f"-- available CPUs: {cpus}; client file concurrency: {client_slots}",
            f"-- client test files: 239; concurrency: {client_slots}",
        ], name
        assert len(summary["summary"]) == 1 and re.fullmatch(r"== 0 failure\(s\) in \d+ s", summary["summary"][0]), name
        assert len(summary["stages"]) == 13 and all(s.startswith("-- ok:") for s in summary["stages"]), name
        assert summary["rust"] == {"passed": 4342, "failed": 0, "ignored": 33}, name
        node = summary["node_summaries"]
        assert [s for s in node if s.startswith("ℹ pass ")] == ["ℹ pass 9", "ℹ pass 5197", "ℹ pass 79"], name
        assert [s for s in node if s.startswith("ℹ skipped ")] == ["ℹ skipped 0", "ℹ skipped 10", "ℹ skipped 0"], name
        assert all(s.endswith(" 0") for s in node if s.startswith(("ℹ fail ", "ℹ cancelled "))), name
        assert summary["wasm"] == ["wasm 2040531 B raw, 592979 B gzip (budget 593719: ok)"], name
        raw = (report / f"{name}.log").read_text()
        required_models = [
            "online session state machine preserves I1–I13 across 5,000 seeded three-runtime sequences",
            "local session state machine preserves I1–I13 across 5,000 seeded three-runtime sequences",
            "online clients preserve R1–R6 across 3,000 seeded interleavings",
        ]
        for host in ("process", "wasm"):
            required_models += [f"mixed evidence schedule {host}: 300 independent histories",
                                f"ordinary search generated oracle {host}: 300 seeds"]
            assert json.dumps({"host": host, "seeds": 300, "failedSeeds": 0, "failures": []}, separators=(",", ":")) in raw, name
        for model in required_models:
            assert re.search(r"^✔ " + re.escape(model) + r" \(\d", raw, re.M), (name, model)
    result["runs"].append({
        "name": name, "summary": summary["summary"], "rust": summary["rust"],
        "node_summaries": summary["node_summaries"], "wasm": summary["wasm"],
        "inventory": summary["inventory"], "elapsed_seconds": meta["elapsed_seconds"],
        "log_sha256": summary["sha256"], "metadata_sha256": digest(report / f"{name}.json"),
    })

startup = read("qualified-slow-3-startup-summary.json")
assert startup["exit"] == 0 and startup["required_delay_ms"] == 300
assert startup["resumed_child_execs"] > 0 and startup["min_observed_delay_ms"] >= 300
assert startup["resumed_child_execs"] + startup["ended_before_resume"] == startup["child_exec_events"]
assert startup["trace_sha256"] == digest(report / "qualified-slow-3-exec.log")
result["startup"] = startup
result["all_attempts"] = matrix["attempts"]
wasm = report.parents[1] / "packages/snapback4/src/wasm/snapback4_device_bg.wasm"
result["wasm_sha256"] = digest(wasm)
(report / "qualification.json").write_text(json.dumps(result, indent=2) + "\n")
print("Validated: three whole heavy passes, slow startup, whole guide, final unconfined suite.")
print(attempts["final-unconfined"]["summary"][0])
