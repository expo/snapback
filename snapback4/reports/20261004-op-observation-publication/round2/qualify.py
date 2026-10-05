"""Run from snapback4 on eb1000; sample idle sibling pairs before confinement."""
import json, os, subprocess, time
from pathlib import Path

root = Path.cwd()
out = root / 'target/op/round2'
tools = 'reports/20261003-lu-live-update-latency/tools/'
report = 'reports/20261004-op-observation-publication/'

def snapshot():
    return {int(p[0][3:]): list(map(int, p[1:9])) for line in Path('/proc/stat').read_text().splitlines()
            if (p := line.split())[0][3:].isdigit()}

a = snapshot(); time.sleep(3); b = snapshot()
busy = {c: round(100 * (1 - (b[c][3]+b[c][4]-a[c][3]-a[c][4]) / (sum(b[c])-sum(a[c]))), 2) for c in a}
pairs = {tuple(map(int, Path(f'/sys/devices/system/cpu/cpu{c}/topology/thread_siblings_list').read_text().strip().split(','))) for c in a}
chosen = sorted((max(busy[c] for c in pair), pair) for pair in pairs)[:11]
assert len(chosen) == 11 and chosen[-1][0] < 5, 'need eleven idle physical cores'
groups = [('stress-a', chosen[:2], 1, 4), ('stress-b', chosen[2:4], 5, 7), ('stress-c', chosen[4:6], 8, 10), ('idle', chosen[6:], 0, 0)]
masks = {name: ','.join(map(str, sorted(c for _, pair in group for c in pair))) for name, group, *_ in groups}
(out/'idle-qualification.json').write_text(json.dumps(dict(at=time.time(), host=os.uname().nodename, busy=busy, chosen=chosen, masks=masks), indent=2)+'\n')
children, results, disk = [], [], []
for name, _, first, last in groups:
    if name == 'idle':
        command = ['node', tools+'measure.mjs']
        env = dict(os.environ, SNAPBACK4_BIN='target/lu-op', LU_SDK='target/op/sdk-r2-final/dist',
                   LU_LABEL='op-round2-final', LU_RUNS='30', LU_HISTORY='1000', LU_REFOLLOW='1', LU_LEVELS='0', LU_OUT=str(out/'idle.json'))
    else:
        command = ['python3', report+'round2-stress.py']
        env = dict(os.environ, OP_STRESS_FIRST=str(first), OP_STRESS_LAST=str(last), OP_STRESS_OUT='target/op/round2/'+name)
    log = (out/(name+'.log')).open('w')
    child = subprocess.Popen(['taskset', '-c', masks[name], 'python3', tools+'confine.py', *command], env=env, stdout=log, stderr=subprocess.STDOUT)
    children.append((name, child, log, time.time()))
(out/'active.json').write_text(json.dumps([dict(name=name, pid=child.pid, mask=masks[name]) for name, child, *_ in children], indent=2)+'\n')
time.sleep(5)
for name, child, *_ in children:
    canonical = Path(f'/proc/{child.pid}/status').read_text().split('Cpus_allowed_list:\t')[1].splitlines()[0]
    audit = subprocess.run(['python3', tools+'audit-affinity.py', str(child.pid), canonical], capture_output=True, text=True)
    (out/(name+'.affinity.json')).write_text(audit.stdout or audit.stderr)
    assert audit.returncode == 0
while children:
    usage = subprocess.run(['du', '-sb', str(root.parent)], capture_output=True, text=True)
    total = int(usage.stdout.split()[0]); assert total < 40_000_000_000
    disk.append(dict(at=time.time(), bytes=total))
    for entry in children[:]:
        name, child, log, started = entry
        if child.poll() is None:
            continue
        log.close(); children.remove(entry)
        result = dict(name=name, pid=child.pid, exit=child.returncode, seconds=round(time.time()-started, 3))
        results.append(result); print(json.dumps(result), flush=True)
        if name == 'idle' and child.returncode == 0:
            subprocess.run(['node', tools+'finalize.mjs', str(out/'idle.json')], check=True)
    (out/'runs.json').write_text(json.dumps(results, indent=2)+'\n')
    (out/'disk.json').write_text(json.dumps(disk, indent=2)+'\n')
    if children:
        time.sleep(5)
raise SystemExit(any(r['exit'] for r in results))
