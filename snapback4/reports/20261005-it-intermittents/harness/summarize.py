#!/usr/bin/env python3
"""Read the native receipts; never retry or reinterpret a failed invocation."""
import collections
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parent.parent
summary = {}
for phase, expected in (("baseline", 1020), ("fixed", 120), ("candidate", 180), ("worker-fixed", 60), ("worker-final", 60)):
    rows = [json.loads(line) for path in sorted((root / phase).glob("group-*.jsonl"))
            for line in path.read_text().splitlines()]
    assert len({row["name"] for row in rows}) == len(rows), "duplicate invocation"
    grouped = collections.defaultdict(list)
    for row in rows:
        grouped[Path(row["file"]).name].append(row)
    files = {}
    for name, runs in sorted(grouped.items()):
        files[name] = {
            "runs": len(runs), "passed": sum(row["passed"] for row in runs),
            "failed": [row["name"] for row in runs if not row["passed"]],
            "counts": dict(sum((collections.Counter(row["counts"]) for row in runs), collections.Counter())),
            "seconds": round(sum(row["elapsed"] for row in runs) / 1000, 3),
        }
    summary[phase] = {"completed": len(rows), "expected": expected, "files": files}
if "--json" in sys.argv:
    print(json.dumps(summary, indent=2))
else:
    for phase, result in summary.items():
        failures = [failure for file in result["files"].values() for failure in file["failed"]]
        print(f"{phase}: {result['completed']}/{result['expected']} files; failures: {failures}")
