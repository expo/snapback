#!/usr/bin/env python3
"""Regenerate MIXED.md from the three retained real-clock runs."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent
lines = ["# Real-clock mixed load", "",
"Each cell observes 125 seconds, then drains for four seconds under the same load. "
"Delays and runtimes below are milliseconds. Schedule lists include every observed "
"boundary in chronological order (including adjacent preparation/drain boundaries); "
"raw summaries retain the timestamps and explicitly expected observation boundaries. "
"Reclamation and requeue have approximately 50 ms polling uncertainty plus observer "
"scheduling. Expiry max excludes the final drain's coarsely observed deletions, which "
"remain in the raw samples. These are observations, not product guarantees.", "",
"| Design | Busy | Schedule firing delays | Job elapsed | Expiry max | Lease recovery max | Backlog max | Reads |",
"|---|---:|---|---|---:|---:|---:|---:|"]
for directory, label in [("mixed-before", "Before CT"), ("mixed-after", "Demoted"), ("mixed-restored", "Restored maintenance")]:
    cells = json.loads((root / directory / "summary.json").read_text())
    assert len(cells) == 4
    for c in cells:
        assert c["unexpectedLeaseChanges"] == 0
        assert c["extensionMs"] == 1000
        assert c["deadlineOutcomes"] == ["E_EFFECT_DEADLINE"]
        assert c["effects"] == 508 and c["retries"] == 106
        assert len(c["leaseRecovery"]) == 6
        assert all(r["maintenanceOnly"] for r in c["leaseRecovery"])
        jobs = sorted(c["jobs"], key=lambda j: j["boundary"])
        delays = ", ".join(str(j["delay"]) for j in jobs)
        runs = ", ".join(str(j["runtime"]) for j in jobs)
        recovery = max(r["delay"] for r in c["leaseRecovery"])
        lines.append(f'| {label} | {c["busy"]} | {delays} | {runs} | {c["expiryMaxMs"]} | {recovery} | {c["backlogMax"]} | {c["reads"]:,} |')
lines += ["", "All twelve cells deliver 507 normal/probe effects and durably reject the "
          "one deliberately late effect with E_EFFECT_DEADLINE. In these first matrices, "
          "the slow effect was emitted before the lease-extension clock advance, which "
          "could trigger its deadline. Separate deadline-only controls (see REPORT.md) "
          "supply the real-clock evidence; the corrected harness emits it afterwards. "
          "Each has 106 retries "
          "(100 injected first-attempt failures and six abandoned leases), no lease "
          "heartbeat/change within an attempt, and one exact 1,000 ms development-clock "
          "extension before observation. All expected schedule boundaries finish once; "
          "all expiring rows and abandoned leases clear.", "",
          "`mixed-after` is the demoted candidate, not the final product. The final "
          "candidate restores maintenance to its original Linux priority and Darwin "
          "default. Exact observed maxima still vary with sweep phase, observer delay "
          "and shared-host scheduling; restoration is a policy rollback, not evidence "
          "that every timing quantile is nonregressing. Before/demoted runs overlap "
          "some exploratory compilation/tests; this lane's full suite starts after these matrices. A process snapshot during qualification also found lane-bg running its Rust suite on the shared host, overlapping the restored comparison. No other lane was stopped.", ""]
(root / "MIXED.md").write_text("\n".join(lines))
