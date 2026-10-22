#!/usr/bin/env python3
"""Detached CPU sampler for recorded app/load/proxy/SSH PIDs only."""
import json
import os
from pathlib import Path
import sys
import time

from run import cpu_sample, write

raw=Path(sys.argv[1]).resolve();done=Path(sys.argv[2]).resolve()
with (raw/'pids.jsonl').open('a') as f:
    f.write(json.dumps(dict(pid=os.getpid(),kind='local-observer',time=time.time()))+'\n')
count=0
with (raw/'local-cpu.jsonl').open('x') as out:
    while not done.exists():
        lines=(raw/'pids.jsonl').read_text().splitlines(keepends=True)
        events=[json.loads(s) for s in lines if s.endswith('\n')]
        roles={e['pid']:e['kind'] for e in events if e['kind'] in ('serve','proxy','tunnel') or e['kind'].startswith('rate-')}
        sample=cpu_sample(roles)
        sample['roles']={str(pid):kind for pid,kind in roles.items() if sample['processes'].get(str(pid))}
        sample['processes']={pid:v for pid,v in sample['processes'].items() if v}
        sample['clock_ticks']=os.sysconf('SC_CLK_TCK')
        out.write(json.dumps(sample)+'\n');out.flush();count+=1
        time.sleep(.25)
write(raw/'local-observer-cleanup.json',dict(pid=os.getpid(),samples=count,still_running=[]))
