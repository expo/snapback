"""Validate every recorded start delay after a slow-start experiment ends."""
import hashlib
import json
from pathlib import Path
import re
import sys

report = Path(__file__).resolve().parent
name = sys.argv[1]
meta = json.loads((report / f'{name}.json').read_text())
assert 'end' in meta, 'wait for this slow run to finish'
if meta['mode'] == 'slow':
    delay_ms = int(meta['wrapper'][1])
else:
    # A focused control may select a different delay explicitly in its command.
    assert Path(meta['command'][0]).name == 'slow-exec', meta['command']
    assert Path(meta['command'][2]) == report / f'{name}-exec.log'
    delay_ms = int(meta['command'][1])
path = report / f'{name}-exec.log'
data = path.read_bytes()
starts, resumed, roots = {}, {}, []
for line in data.decode().splitlines():
    if line.startswith('root-exec '):
        roots.append(line)
        continue
    match = re.fullmatch(r'exec pid=(\d+) at_ns=(\d+) due_ns=(\d+)', line)
    if match:
        key = (int(match[1]), int(match[3]))
        assert key not in starts
        starts[key] = int(match[2])
        assert key[1] - starts[key] == delay_ms * 1_000_000
        continue
    match = re.fullmatch(r'resume pid=(\d+) at_ns=(\d+) due_ns=(\d+)', line)
    assert match, line
    key = (int(match[1]), int(match[3]))
    assert key in starts and key not in resumed
    resumed[key] = int(match[2]) - starts[key]
    assert resumed[key] >= delay_ms * 1_000_000
assert len(roots) == 1 and resumed
result = {
    'run': name, 'exit': meta['exit'], 'trace_sha256': hashlib.sha256(data).hexdigest(),
    'required_delay_ms': delay_ms, 'child_exec_events': len(starts),
    'resumed_child_execs': len(resumed), 'ended_before_resume': len(starts) - len(resumed),
    'min_observed_delay_ms': min(resumed.values()) / 1_000_000,
    'max_observed_delay_ms': max(resumed.values()) / 1_000_000,
    'root_first_exec_delayed': False,
}
(report / f'{name}-startup-summary.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
