#!/usr/bin/env python3
"""Run the new work bound against round 0's implementation; always restore it."""
from pathlib import Path
import os, subprocess

root = Path(__file__).resolve().parents[3]
paths = ["engine/row_views.rs", "engine/row_views/batch.rs", "engine/row_views/live.rs",
         "engine/runner.rs", "maintain/row_key.rs", "successor.rs"]
saved = {}
try:
    for relative in paths:
        path = root / "crates/snapback4-core/src" / relative
        saved[path] = path.read_bytes()
        original = subprocess.check_output(["git", "show", "c0d6d1ee28:snapback4/crates/snapback4-core/src/" + relative], cwd=root)
        if relative == "engine/row_views.rs":
            original += b'\n#[cfg(all(test, feature = "sqlite"))]\nmod certification_tests;\n'
        path.write_bytes(original)
    result = subprocess.run(["cargo", "test", "-p", "snapback4-core", "--lib",
        "certification_delivery_work_is_independent_of_ten_or_hundred_thousand_history", "--", "--nocapture"],
        cwd=root, env={**os.environ, "LIBSQLITE3_FLAGS": "-USQLITE_ENABLE_MEMORY_MANAGEMENT"})
    print(f"round-0 work-control exit={result.returncode}", flush=True)
    assert result.returncode == 101, "round 0 unexpectedly passed the new work bound"
finally:
    for path, contents in saved.items(): path.write_bytes(contents)
