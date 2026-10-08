#!/usr/bin/env python3
"""Build one test-only negative control at a time; restore source in finally.

Stress runs use fs-fixed-unit, an immutable copy. The ordinary CLI is never
rebuilt by these --bin unit-only builds. Each control retains a holder through
the original positive assertion, which must still fail.
"""
import os
from pathlib import Path
import shutil
import subprocess
import sys

report = Path(__file__).resolve().parent
root = report.parents[1]
base = root / 'crates/snapback4/src/verbs/witness'
controls = [
    ('smoke', 'smoke.rs', 'smoke::tests::smoke_barrier_advances_only_the_commit_clock',
     'drop(inherited); // wait for the last known holder, not a scheduling delay',
     'let _still_inherited = inherited; // negative control: retain custody'),
    ('retention', 'publication.rs', 'publication::tests::witness_orphan_reconciliation_requires_all_leases_and_preserves_changed_identity',
     'drop(inherited);', 'let _still_inherited = inherited; // negative control'),
    ('recovery', 'recovery.rs', 'recovery::tests::discovery_of_an_unfinished_leased_export_keeps_maintenance_pending',
     'drop(inherited);', 'let _still_inherited = inherited; // negative control'),
    ('lease', 'preparation.rs', 'preparation::tests::lease_preserves_an_existing_owner_and_releases_on_drop',
     'assert_eq!(status, 0);\n        assert!(lease(&path).is_ok());',
     'assert_eq!(status, 0);\n        let _still_held = lease(&path).unwrap();\n        assert!(lease(&path).is_ok());'),
    ('deadline', 'preparation_deadline.rs', 'preparation_deadline::tests::completion_receipt_does_not_charge_later_cleanup_to_preparation',
     'self.record(completed)', 'self.record(Instant::now())'),
    ('ownerless', 'recovery.rs', 'recovery::tests::ownerless_shell_waits_only_for_live_leases_without_becoming_finished_evidence',
     'drop(held);', 'std::mem::forget(held); // control: hold until isolated process exit'),
]
for label, file, case, before, after in controls:
    if len(sys.argv) > 1 and label not in sys.argv[1:]:
        continue
    path = base / file
    original = path.read_text()
    assert before in original
    try:
        path.write_text(original.replace(before, after, 1))
        with (report / f'build-control-{label}.log').open('w') as log:
            subprocess.run(['cargo', 'test', '-p', 'snapback4', '--bin', 'snapback4', '--no-run', '-j', '6'],
                cwd=root, env={**os.environ, 'LIBSQLITE3_FLAGS': '-USQLITE_ENABLE_MEMORY_MANAGEMENT'},
                stdout=log, stderr=subprocess.STDOUT, check=True)
        binary = root / 'target/debug/deps/snapback4-54c72c0d37cc6d9b'
        control = root / f'target/debug/deps/fs-control-{label}'
        shutil.copy2(binary, control)
        subprocess.run(['python3', str(report/'repeat.py'), '--label', f'control-rust-{label}',
            '--rounds', '1', '--jobs', '1', '--cpus', '82,83', '--', str(control),
            '--exact', 'verbs::witness::'+case, '--nocapture'], cwd=root, check=True)
    finally:
        path.write_text(original)
