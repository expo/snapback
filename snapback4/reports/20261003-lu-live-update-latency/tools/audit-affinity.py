from pathlib import Path
import json,sys,datetime,collections
# Read-only sample of a running process tree; confinement itself is enforced by confine.py.
# Usage: python3 audit-affinity.py ROOT_PID EXPECTED_MASK
expected=sys.argv[2]
root=int(sys.argv[1]);todo=[root];seen=set();masks=collections.Counter();names=collections.Counter()
while todo:
 pid=todo.pop()
 if pid in seen:continue
 seen.add(pid);p=Path('/proc')/str(pid)
 try:
  names[p.joinpath('comm').read_text().strip()]+=1
  for task in p.joinpath('task').iterdir():
   todo.extend(map(int,task.joinpath('children').read_text().split()))
   status=task.joinpath('status').read_text();mask=next(line.split(':',1)[1].strip() for line in status.splitlines() if line.startswith('Cpus_allowed_list:'))
   masks[mask]+=1
 except (OSError,StopIteration):pass
assert dict(masks).keys()=={expected},masks
print(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'root':root,'processes':len(seen),'thread_masks':dict(masks),'names':dict(names)}))
