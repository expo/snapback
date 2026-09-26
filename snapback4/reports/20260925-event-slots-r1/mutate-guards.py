#!/usr/bin/env python3
"""Reproduce the two rejected guard mutations. Run with no other build in this tree."""
from pathlib import Path
import os
import subprocess

root = Path(__file__).resolve().parents[2]
source = root / 'crates/snapback4-core/src/engine/timeline/slots.rs'
original = source.read_text()
start = original.index('        if self.device', original.index('    pub(super) fn timeline_aggregate_fence'))
end = original.index('        Ok(())', start)
mutants = {
    'aggregate-body': original[:start] + original[end:],
    'unrepost-guard': original.replace('        self.timeline_aggregate_fence(t, repost)?;\n', ''),
}
env = dict(os.environ, CARGO_BUILD_JOBS='8')
log_dir = root / 'target/event-slot-mutations'
log_dir.mkdir(exist_ok=True)
command = ['cargo', 'test', '-p', 'snapback4-device', '--test', 'event_slots_trace']
try:
    for name, changed in mutants.items():
        assert changed != original
        source.write_text(changed)
        log_path = log_dir / f'{name}.log'
        with log_path.open('w') as log:
            run = subprocess.run(command, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
        text = log_path.read_text()
        assert run.returncode != 0, f'{name} survived'
        assert 'panicked at crates/snapback4-device/tests/event_slots_trace.rs:' in text, text
        assert '"predicted":[' in text, text
        print(f'{name}: rejected (exit {run.returncode}), {log_path}')
        source.write_text(original)
finally:
    source.write_text(original)
with (log_dir / 'restored.log').open('w') as log:
    run = subprocess.run(command, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
assert run.returncode == 0, 'restored implementation must pass and regenerate the replay traces'
print('restored: passed')
