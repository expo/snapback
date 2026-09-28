"""Negative controls; run only when no other build uses this worktree."""
import json
import os
from pathlib import Path
import subprocess

evidence = Path(__file__).resolve().parent
root = evidence.parents[2]
cases = [
    ("gs-emission-stamp", "membership_search.rs",
     "            self.stamp_source(&scan.table, &mut row)?;",
     "            // Deliberately omit the emitted hit's stamp.",
     "compact_membership_search_reports_only_authorized_emitted_images"),
    ("cq-lookahead", "read.rs",
     "let stop_at_bound = !aborting &&", "let stop_at_bound = false && !aborting &&",
     "cursorless_page_stamps_its_exact_bound_without_lookahead"),
    ("er-mutation-stamp", "delivery.rs",
     "if self.device || self.meter.cut != crate::meter::Cut::Cap",
     "if self.device",
     "admitted_expiring_scans_keep_query_delivery_out_of_mutations_and_replay"),
]
env = dict(os.environ, CARGO_BUILD_JOBS="8", RUST_TEST_THREADS="4")
results = []
for name, file, old, new, test in cases:
    path = root / "crates/snapback4-core/src/engine" / file
    original = path.read_bytes()
    assert original.count(old.encode()) == 1, name
    try:
        path.write_bytes(original.replace(old.encode(), new.encode()))
        result = subprocess.run(
            ["cargo", "test", "-p", "snapback4-lang", "--test", "delivery_integration", test, "--", "--exact"],
            cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        (evidence / f"mutant-{name}.txt").write_text(result.stdout)
        killed = result.returncode == 101 and f"test {test} ... FAILED" in result.stdout
        results.append(dict(name=name, test=test, exit=result.returncode, killed=killed))
        print(json.dumps(results[-1]), flush=True)
    finally:
        path.write_bytes(original)
    assert killed, name
(evidence / "mutations.json").write_text(json.dumps(results, indent=2) + "\n")
