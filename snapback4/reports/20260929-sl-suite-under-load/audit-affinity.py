"""Read-only snapshot of a live run's process/thread and worker affinity."""
import datetime
import json
import os
from pathlib import Path
import sys

report = Path(__file__).resolve().parent
name = sys.argv[1]
meta = json.loads((report / f"{name}.json").read_text())
assert "end" not in meta, "run already completed"
parents = {}
for stat in Path('/proc').glob('[0-9]*/stat'):
    try:
        fields = stat.read_text().rsplit(')', 1)[1].split()
        parents[int(stat.parent.name)] = int(fields[1])
    except (OSError, ValueError):
        pass
owned = {meta['suite_pid'], *meta['load_pids']}
while True:
    children = {pid for pid, parent in parents.items() if parent in owned}
    if children <= owned:
        break
    owned |= children
masks = {}
for pid in sorted(owned):
    for task in Path(f'/proc/{pid}/task').glob('[0-9]*'):
        try:
            masks[f'{pid}/{task.name}'] = sorted(os.sched_getaffinity(int(task.name)))
        except ProcessLookupError:
            pass
allowed = set(range(80, 96))
violations = {pid: mask for pid, mask in masks.items() if not set(mask) <= allowed}
result = {'run': name, 'unit': 'process/thread', 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'observed': len(masks), 'affinities': masks, 'violations': violations}
with (report / 'affinity-audits.jsonl').open('a') as output:
    output.write(json.dumps(result) + '\n')
print(name, 'observed threads:', len(masks), 'outside 80-95:', len(violations))
assert not violations, violations
