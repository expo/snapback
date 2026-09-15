#!/usr/bin/env python3
"""Validate complete 119-ID grades and report prior-101 and M8 subtotals."""

import json
import hashlib
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WAVES = ["astra", "grok", "muse"]
RESULTS = {"pass", "fail", "not-run", "not-applicable"}

manifest = json.loads((ROOT / "instrument/schema/social-messenger/assertions.json").read_text())
manifest_path = ROOT / "instrument/schema/social-messenger/assertions.json"
manifest_sha256 = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
all_ids = {item["id"] for milestone in manifest["milestones"].values() for item in milestone["assertions"]}
prior_ids = set((ROOT / "GRADER_ASSERTIONS_101.txt").read_text().splitlines())
m8_ids = {item["id"] for item in manifest["milestones"]["M8"]["assertions"]}
if len(all_ids) != 119 or len(prior_ids) != 101 or len(m8_ids) != 18 or prior_ids | m8_ids != all_ids or prior_ids & m8_ids:
    raise SystemExit("the 119 = prior 101 + M8 18 assertion partition changed")


def subtotal(results: dict, ids: set[str]) -> dict[str, int]:
    counts = Counter(results[assertion]["result"] for assertion in ids)
    unknown = set(counts) - RESULTS
    if unknown:
        raise SystemExit(f"unknown grade results: {sorted(unknown)}")
    return {result: counts.get(result, 0) for result in sorted(RESULTS)}


summary = {
    "assertionPartition": {
        "complete": 119,
        "priorComparable": 101,
        "m8CoverageAdded": 18,
        "priorGap": "The September 5 and September 12 structured assertionResults omitted every M8 ID; notes could contain unstructured M8 observations.",
    },
    "lanes": {},
}
for wave in WAVES:
    lifecycle = ROOT / "logs" / f"{wave}-snapback4.grade.end.json"
    if not lifecycle.is_file():
        raise SystemExit(f"grade has no lifecycle end record: {wave}")
    if json.loads(lifecycle.read_text()).get("exitCode") != 0:
        raise SystemExit(f"grade did not exit successfully: {wave}")
    grading = ROOT / "lanes" / f"{wave}-snapback4" / "grading"
    path = grading / "grader-report.json"
    m8_path = grading / "m8-assertion-results.json"
    report = json.loads(path.read_text())
    supplement = json.loads(m8_path.read_text())
    prior_results = report.get("assertionResults", {})
    m8_results = supplement.get("assertionResults", {})
    if set(prior_results) != prior_ids:
        missing = sorted(prior_ids - set(prior_results))
        extra = sorted(set(prior_results) - prior_ids)
        raise SystemExit(f"{wave} schema report is not the exact prior 101: missing={missing}, extra={extra}")
    if set(m8_results) != m8_ids:
        missing = sorted(m8_ids - set(m8_results))
        extra = sorted(set(m8_results) - m8_ids)
        raise SystemExit(f"{wave} M8 supplement is not the exact 18: missing={missing}, extra={extra}")
    if supplement.get("reportVersion") != 1 or supplement.get("lane") != f"{wave}-snapback4":
        raise SystemExit(f"{wave} M8 supplement identity is invalid")
    grader = supplement.get("grader", {})
    if grader != {"family": "claude", "model": "claude-opus-5"}:
        raise SystemExit(f"{wave} M8 supplement grader identity is invalid")
    manifest_pin = supplement.get("assertionManifest", {})
    if manifest_pin.get("sha256") != manifest_sha256 or Path(manifest_pin.get("path", "")).resolve() != manifest_path.resolve():
        raise SystemExit(f"{wave} M8 supplement assertion-manifest pin is invalid")
    results = {**prior_results, **m8_results}
    summary["lanes"][wave] = {
        "complete119": subtotal(results, all_ids),
        "priorComparable101": subtotal(results, prior_ids),
        "m8Only18": subtotal(results, m8_ids),
        "report": str(path.relative_to(ROOT)),
        "m8Supplement": str(m8_path.relative_to(ROOT)),
    }

out = ROOT / "grades"
out.mkdir(exist_ok=True)
(out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
columns = ["pass", "fail", "not-run", "not-applicable"]
lines = [
    "# Independent grade totals", "",
    "The complete grade covers all 119 frozen IDs. The comparable 101 subtotal is the exact M1–M7 structured set used by the September 5 and September 12 reports; their assertionResults omitted all 18 M8 IDs, though notes could carry unstructured observations.", "",
    "| Lane / set | " + " | ".join(columns) + " |",
    "| --- | " + " | ".join("---:" for _ in columns) + " |",
]
for wave in WAVES:
    for label, key in (("complete 119", "complete119"), ("prior-comparable 101", "priorComparable101"), ("M8 only 18", "m8Only18")):
        counts = summary["lanes"][wave][key]
        lines.append(f"| {wave} / {label} | " + " | ".join(str(counts[column]) for column in columns) + " |")
(out / "summary.md").write_text("\n".join(lines) + "\n")
print("validated three complete 119-assertion grades and wrote prior-101/M8 subtotals")
