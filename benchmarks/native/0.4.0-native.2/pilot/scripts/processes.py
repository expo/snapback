"""Builder custody across shell-created sessions. Never kill by name or port.

The random inherited environment tag also finds reparented/detached children.
Only PID/start identities are retained; process environments are never logged.
"""
import re, uuid
from common import *

TAG = 'CLIQUE_PROCESS_OWNER'

def process_table():
    raw = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,pgid=,stat=,lstart=,command='], text=True)
    rows = {}
    for line in raw.splitlines():
        fields = line.split(None, 9)
        if len(fields) != 10: continue
        pid, parent, group, state = fields[:4]
        rows[int(pid)] = {'pid': int(pid), 'ppid': int(parent), 'pgid': int(group),
                          'state': state, 'started': ' '.join(fields[4:9]), 'executable': fields[9].split()[0]}
    return rows

def tagged_pids(token):
    if platform.system() == 'Linux':
        result = set()
        for p in Path('/proc').glob('[0-9]*/environ'):
            try:
                if (TAG + '=' + token).encode() in p.read_bytes().split(b'\0'): result.add(int(p.parent.name))
            except (FileNotFoundError, PermissionError, ProcessLookupError): pass
        return result
    # macOS ps appends inherited environment; consume in memory, never persist it.
    raw = subprocess.check_output(['ps', 'eww', '-axo', 'pid=,command='], text=True)
    needle = re.compile(r'(?:^|\s)' + TAG + '=' + re.escape(token) + r'(?:\s|$)')
    return {int(line.split(None, 1)[0]) for line in raw.splitlines() if needle.search(line)}

def booted_simulators():
    if platform.system() != 'Darwin': return []
    data = json.loads(subprocess.check_output(['xcrun', 'simctl', 'list', 'devices', '--json'], text=True))
    return sorted(d['udid'] for devices in data['devices'].values() for d in devices if d['state'] == 'Booted')

def simulator_targets(baseline, current):
    return sorted(set(current) - set(baseline) - {UDID})

class ProcessOwner:
    def __init__(self, logs, state=None):
        self.logs = Path(logs)
        self.state = state or {'token': str(uuid.uuid4()), 'rootPid': None,
                              'simulatorsBefore': booted_simulators(), 'known': {}}
        self.path = self.logs / 'process-owner.json'
        if state is None: self.save()

    def save(self):
        tmp = self.path.with_suffix('.tmp')
        tmp.write_text(json.dumps(self.state, indent=2) + '\n'); os.replace(tmp, self.path)

    def start(self, process):
        self.state['rootPid'] = process.pid
        # This Popen is our direct child and was created with start_new_session.
        self.state['known'][str(process.pid)] = process_table()[process.pid]
        self.save(); self.sample()

    def sample(self, persist=True):
        table = process_table(); known = self.state['known'] if persist else dict(self.state['known'])
        owned = {pid for pid, row in table.items() if str(pid) in known and row['started'] == known[str(pid)]['started']}
        groups = {row['pgid'] for row in known.values()}
        # A child may clear its environment yet remain in our original group.
        # A live replacement leader with a different start identity invalidates
        # the historical group id; surviving leaderless groups retain custody.
        groups = {group for group in groups if group not in table or
                  (str(group) in known and table[group]['started'] == known[str(group)]['started'])}
        owned |= {pid for pid, row in table.items() if row['pgid'] in groups}
        owned |= tagged_pids(self.state['token']) & table.keys()
        while True:
            added = {pid for pid, row in table.items() if row['ppid'] in owned}
            if added <= owned: break
            owned |= added
        for pid in owned:
            if pid == os.getpid(): raise RuntimeError('process-owner-includes-supervisor')
            row = table[pid]
            if persist and (str(pid) not in known or row['started'] != known[str(pid)]['started']):
                record(self.logs / 'processes.jsonl', kind='owned', **row)
            known[str(pid)] = row
        if persist: self.save()
        return {pid: table[pid] for pid in owned if not table[pid]['state'].startswith('Z')}

    def cleanup(self, process=None, grace=10):
        receipt = self.logs / 'cleanup.jsonl'; sent = set()
        record(receipt, kind='cleanup-start', rootPid=self.state['rootPid'])
        for sig, duration in [(signal.SIGTERM, grace), (signal.SIGKILL, 5)]:
            deadline = time.monotonic() + duration
            while True:
                if process is not None: process.poll()  # reap the leader, not just wait for it
                live = self.sample()
                for pid, row in live.items():
                    key = (pid, row['started'], sig)
                    if key in sent: continue
                    # Recheck identity immediately before signalling; do not trust a saved PID.
                    current = process_table().get(pid)
                    if current is None or current['started'] != row['started'] or current['state'].startswith('Z'): continue
                    record(receipt, kind='signal', signal=int(sig), **row)
                    if signal_owned(os.kill, pid, sig): sent.add(key)
                if not live or time.monotonic() >= deadline: break
                time.sleep(.1)
            if not live: break
        remaining = self.sample()
        if remaining:
            record(receipt, kind='cleanup-failed', remaining=list(remaining.values()))
            raise HarnessDefect('builder-process-cleanup-incomplete')
        # CoreSimulator services are launchd children, not builder descendants.
        # A new boot since our baseline is not ownership evidence. The operator
        # is authorized for UDID only; preserve every other device, even on a
        # shared host where another session boots one during a builder run.
        targets = simulator_targets(self.state['simulatorsBefore'], booted_simulators())
        for device in targets:
            record(receipt, kind='unowned-simulator-preserved', udid=device)
        if process is not None: process.wait(timeout=5)
        record(receipt, kind='cleanup-complete', signalled=len(sent), simulators=[], preservedSimulators=targets)
        return {'complete': True, 'signalled': len(sent), 'simulators': [], 'preservedSimulators': targets}

    @classmethod
    def resume(cls, logs):
        return cls(logs, read(Path(logs) / 'process-owner.json'))
