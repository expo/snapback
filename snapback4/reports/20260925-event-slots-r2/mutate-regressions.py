#!/usr/bin/env python3
"""Reject each round-two mutant independently; run without another build in this tree."""
from pathlib import Path
import os
import subprocess

root = Path(__file__).resolve().parents[2]
slots = root / 'crates/snapback4-core/src/engine/timeline/slots.rs'
partition = root / 'crates/snapback4-core/src/partition.rs'
originals = {path: path.read_text() for path in (slots, partition)}
start = originals[slots].index('        if self.device', originals[slots].index('    pub(super) fn timeline_aggregate_fence'))
mutants = [
    ('original-removal-bypass', slots,
     originals[slots][:start] + '        if !repost { return Ok(()); }\n' + originals[slots][start:],
     ['-p', 'snapback4-device', '--test', 'event_slots_trace', 'conditional_original_removal_reaches_runtime_aggregate_guard'],
     '"predicted":['),
    ('output-only-page-charge', partition,
     originals[partition].replace('used += work.max(1);', 'used += rows.len().max(1);'),
     ['-p', 'snapback4-core', '--test', 'event_slot_snapshot', 'examined_work_spends_the_budget_before_the_next_owned_group'],
     'page examined'),
    ('minimum-seven-scan', partition,
     originals[partition].replace('if filtered { room }', 'if filtered { room.max(7) }'),
     ['-p', 'snapback4-core', '--test', 'event_slot_snapshot'],
     'examined for'),
]
env = dict(os.environ, CARGO_BUILD_JOBS='8')
logs = root / 'target/event-slot-mutations-r2'
logs.mkdir(exist_ok=True)
try:
    for name, path, changed, args, expected in mutants:
        assert changed != originals[path]
        path.write_text(changed)
        log_path = logs / f'{name}.log'
        with log_path.open('w') as log:
            result = subprocess.run(['cargo', 'test', *args], cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
        output = log_path.read_text()
        assert result.returncode != 0, f'{name} survived'
        assert 'panicked at crates/' in output and expected in output, output
        print(f'{name}: rejected (exit {result.returncode}), {log_path}', flush=True)
        path.write_text(originals[path])
finally:
    for path, original in originals.items():
        path.write_text(original)
for package, test in [('snapback4-core', 'event_slot_snapshot'), ('snapback4-device', 'event_slots_trace')]:
    with (logs / f'restored-{test}.log').open('w') as log:
        result = subprocess.run(['cargo', 'test', '-p', package, '--test', test], cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
    assert result.returncode == 0, f'restored {test} must pass'
print('restored: passed, replay traces regenerated', flush=True)
