#!/usr/bin/env python3
"""Run round-2 property/heap regressions against 4277a65cf4, restoring sources."""
import os, subprocess
from pathlib import Path
root = Path(__file__).resolve().parents[3]
report = root / "reports/20261001-bg-busy-group-render/round2"
files = [root / "crates/snapback4-core/src" / name for name in
         ["engine/row_views.rs", "engine/row_views/certification.rs", "engine/row_views/batch.rs",
          "maintain/row_key.rs", "successor.rs"]]
saved = {path: path.read_bytes() for path in files}
try:
    for path in files:
        relative = path.relative_to(root.parent)
        path.write_bytes(subprocess.check_output(["git", "show", "4277a65cf4:" + str(relative)], cwd=root))
    for name, test, failures in [("property-round1-control", "incremental_certification_matches_naive", 2),
                                  ("heap-round1-final-control", "batch_pages_admit_at_exact", 1)]:
        result = subprocess.run(["cargo", "test", "-p", "snapback4-core", "--lib", test, "--", "--nocapture"], cwd=root,
            env={**os.environ, "LIBSQLITE3_FLAGS": "-USQLITE_ENABLE_MEMORY_MANAGEMENT"}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        log = result.stdout.decode()
        (report / (name + ".log")).write_text(log)
        (report / (name + ".exit")).write_text(str(result.returncode) + "\n")
        assert result.returncode == 101 and f"{failures} failed" in log and "error[E" not in log, log
        print(f"{name}: expected {failures} assertion failures, exit {result.returncode}", flush=True)
finally:
    for path, contents in saved.items(): path.write_bytes(contents)
