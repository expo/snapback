#!/usr/bin/env python3
"""Reject both round-three snapshot mutants, then restore and recheck all cases."""
from pathlib import Path
import os
import subprocess

root = Path(__file__).resolve().parents[2]
source = root / 'crates/snapback4-core/src/partition.rs'
original = source.read_text()
mutants = [
    ('omit-kept-row-charge',
     original.replace('let work = if filtered { examined } else { live.len() };',
                      'let work = if filtered { examined - live.len() } else { live.len() };'),
     'kept_and_excluded_events_both_spend_the_next_groups_budget',
     'the second group must receive only the remaining budget'),
    ('reset-batch-counter',
     original.replace('examined += count;', 'examined = count;'),
     'cumulative_storage_reads_are_bounded_across_multiple_batches',
     'examined for'),
]
command = ['cargo', 'test', '-p', 'snapback4-core', '--test', 'event_slot_snapshot']
env = dict(os.environ, CARGO_BUILD_JOBS='8')
logs = root / 'target/event-slot-mutations-r3'
logs.mkdir(exist_ok=True)
try:
    for name, changed, test, expected in mutants:
        assert changed != original
        source.write_text(changed)
        log_path = logs / f'{name}.log'
        with log_path.open('w') as log:
            result = subprocess.run([*command, test], cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
        text = log_path.read_text()
        assert result.returncode != 0, f'{name} survived'
        assert 'panicked at crates/snapback4-core/tests/event_slot_snapshot.rs:' in text and expected in text, text
        print(f'{name}: rejected (exit {result.returncode}), {log_path}', flush=True)
        source.write_text(original)
finally:
    source.write_text(original)
with (logs / 'restored.log').open('w') as log:
    result = subprocess.run(command, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
assert result.returncode == 0, 'restored snapshot tests must pass'
print('restored: passed', flush=True)
