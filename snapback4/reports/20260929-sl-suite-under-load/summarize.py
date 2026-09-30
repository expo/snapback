"""Extract evidence without discarding any failed execution or raw output."""
import hashlib
import json
from pathlib import Path
import re
import sys

for argument in sys.argv[1:]:
    path = Path(argument)
    text = path.read_text(errors="replace")
    lines = text.splitlines()
    failures = []
    pooled_rust = any(line.startswith("-- FAIL rust target:") for line in lines)
    for index, line in enumerate(lines):
        if line.startswith("-- FAIL rust target:"):
            end = next((i + 1 for i in range(index + 1, len(lines)) if lines[i].startswith("test result:")), len(lines))
            failures.append({"line": index + 1, "kind": "rust", "details": lines[index:end]})
        if not pooled_rust and re.fullmatch(r"---- .+ stdout ----", line):
            end = next((i for i in range(index + 1, len(lines)) if
                        re.fullmatch(r"---- .+ stdout ----", lines[i]) or
                        lines[i] == "failures:" or lines[i].startswith("test result:")), len(lines))
            failures.append({"line": index + 1, "kind": "rust", "details": lines[index:end]})
        if line.startswith("test at "):
            end = next((i for i in range(index + 1, len(lines)) if lines[i].startswith(("test at ", "-- FAIL:", "== "))), len(lines))
            failures.append({"line": index + 1, "kind": "client", "details": lines[index:end]})
    if not pooled_rust and not any(f["kind"] == "rust" for f in failures) and any(line.startswith("test result: FAILED") for line in lines):
        for index, line in enumerate(lines):
            if re.match(r"thread .+ panicked at ", line):
                end = next((i + 1 for i in range(index + 1, len(lines)) if lines[i].startswith("test result:")), len(lines))
                failures.append({"line": index + 1, "kind": "rust", "details": lines[max(0, index - 2):end]})
    rust = [tuple(map(int, m)) for m in re.findall(r"test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored", text)]
    result = {
        "log": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "summary": [line for line in lines if re.fullmatch(r"== \d+ failure\(s\) in \d+ s", line)],
        "stages": [line for line in lines if line.startswith(("-- ok:", "-- FAIL:"))],
        "inventory": [line for line in lines if line.startswith(("-- rust inventory:", "-- available CPUs:", "-- client test files:"))],
        "rust": dict(zip(("passed", "failed", "ignored"), map(sum, zip(*rust)))) if rust else {},
        "node_summaries": [line for line in lines if re.match(r"ℹ (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) ", line)],
        "wasm": [line for line in lines if re.match(r"wasm \d+ B raw", line)],
        "asynchronous_errors": [{"line": i + 1, "text": line} for i, line in enumerate(lines) if "generated asynchronous activity after the test ended" in line],
        "failures": failures,
    }
    path.with_suffix(".summary.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(path.name, result["summary"], f"{len(failures)} failure records")
