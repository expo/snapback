"""Retain all trials; median and nearest-rank p95, in milliseconds."""
import json
import math
import statistics
from pathlib import Path

root = Path(__file__).resolve().parent.parent
summary = {}
for phase in ("baseline", "fixed", "final"):
    for tier in ("wasm", "process"):
        name = f"{phase}-{tier}"
        samples = json.loads((root / f"{name}.json").read_text())["samples"]
        summary[name] = {}
        for flow in ("insert", "update"):
            rows = [sample for sample in samples if sample["flow"] == flow]
            result = {}
            for event in ("published", "render", "returned"):
                values = sorted(row[event] - row["call"] for row in rows)
                result[event] = {
                    "n": len(values),
                    "p50_ms": round(statistics.median(values), 3),
                    "p95_ms": round(values[math.ceil(len(values) * .95) - 1], 3),
                    "min_ms": round(min(values), 3),
                    "max_ms": round(max(values), 3),
                }
            result["rendered_before_return"] = sum(row["render"] < row["returned"] for row in rows)
            # The event and trial stamp call performance.now consecutively;
            # select the first matching image, not floating-point timestamp equality.
            result["pending_at_first_render"] = sum(
                next(image.get("pending") is True
                     for event in row["events"] if event["stage"] == "render"
                     for image in event["read"]["data"]
                     if image.get("emoji") == f'{flow}-{row["run"]}')
                for row in rows
            )
            summary[name][flow] = result
(root / "latency-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
for name, flows in summary.items():
    for flow, result in flows.items():
        print(name, flow, result["render"], "pending", result["pending_at_first_render"], "before return", result["rendered_before_return"])
