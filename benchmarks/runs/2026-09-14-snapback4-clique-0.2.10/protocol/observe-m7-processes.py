#!/usr/bin/env python3
"""Late selected process/listener observation only; never sends a signal."""
import argparse
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/Users/ccheever/projects/snapback-lanebriefs')
PACKET = Path('/Users/ccheever/clique-sb4-20260913-relaxed-3models')

def main(wave):
    lane = PACKET / 'lanes' / f'{wave}-snapback4'
    end = json.loads((PACKET / 'logs' / f'{wave}-snapback4.m7.end.json').read_text())
    pids, sources = {end['pid']}, []
    def collect(value):
        if isinstance(value, dict):
            for k, v in value.items():
                if k.lower() in {'pid', 'parentpid', 'workerpid', 'serverpid'} and isinstance(v, int) and v > 1:
                    pids.add(v)
                else:
                    collect(v)
        elif isinstance(value, list):
            for v in value:
                collect(v)
    for path in sorted((lane / 'm7').rglob('*pids*.json*')):
        if path.is_symlink() or not path.is_file() or 'node_modules' in path.parts:
            continue
        raw = path.read_bytes()
        try:
            records = [json.loads(x) for x in raw.decode().splitlines() if x.strip()] if path.suffix == '.jsonl' else [json.loads(raw)]
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        collect(records)
        sources.append({'path': str(path.relative_to(lane)), 'sha256': hashlib.sha256(raw).hexdigest()})
    for name in ['run-log.md', 'final-report.md']:
        p = lane / 'm7' / name
        raw = p.read_bytes()
        pids.update(int(x) for x in re.findall(r'\bpid\s*[=: ]\s*(\d+)\b', raw.decode(), re.I) if int(x) > 1)
        sources.append({'path': str(p.relative_to(lane)), 'sha256': hashlib.sha256(raw).hexdigest()})
    ps = subprocess.run(['ps', '-p', ','.join(map(str, sorted(pids))), '-o', 'pid=,ppid=,pgid=,comm='], capture_output=True, text=True)
    listeners = subprocess.run(['lsof', '-nP', '-iTCP:49340-49359', '-sTCP:LISTEN', '-Fpcn'], capture_output=True, text=True)
    receipt = {'observedAt': datetime.now(timezone.utc).isoformat(), 'lane': wave, 'phaseEndedAt': end['endedAt'],
               'selectedPids': sorted(pids), 'sources': sources,
               'ps': {'exitCode': ps.returncode, 'stdout': ps.stdout, 'stderr': ps.stderr},
               'assignedListeningSockets': {'exitCode': listeners.returncode, 'stdout': listeners.stdout, 'stderr': listeners.stderr},
               'limits': 'One late observation of PIDs explicitly named in M7 narratives and matching PID JSON ledgers plus the phase child, and listeners in the assigned port range. '
                         'No signals or app requests. Absence is not a complete process inventory at phase end; any live PID may have been reused and needs ownership inspection before action. '
                         'ps records executable names without arguments to avoid exposing credentials.'}
    p = ROOT / 'cell-custody-0.2.10' / wave / 'm7-late-process-observation.json'
    with p.open('x') as f:
        json.dump(receipt, f, indent=2)
        f.write('\n')
    print(json.dumps({'receipt': str(p), 'selectedPidCount': len(pids), 'psExit': ps.returncode,
                      'liveExecutableRows': ps.stdout, 'listeners': listeners.stdout}, indent=2))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('wave', choices=['astra', 'grok', 'muse'])
    main(parser.parse_args().wave)
