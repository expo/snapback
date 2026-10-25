#!/usr/bin/env python3
"""Read /proc for this cluster's recorded postmaster and its direct children.
Run only on 450a. Stops when its SSH stdin closes; never signals a database PID.
"""
import json
import os
from pathlib import Path
import select
import sys
import time

root=Path.home()/'sb4scale'
postmaster=(int(sys.argv[1]) if len(sys.argv)>1 else int((root/'postmaster.pid.recorded').read_text()))
if len(sys.argv)==1:assert postmaster==int((root/'pg17/postmaster.pid').read_text().splitlines()[0])
seen=set()
print(json.dumps({'monitor_pid':os.getpid(),'postmaster':postmaster,'clock_ticks':os.sysconf('SC_CLK_TCK')}),flush=True)
while not select.select([sys.stdin],[],[],.25)[0]:
    processes={}
    for path in Path('/proc').glob('[0-9]*/stat'):
        try:
            fields=path.read_text().rsplit(')',1)[1].split()
            pid=int(path.parent.name)
            if pid==postmaster or int(fields[1])==postmaster:
                processes[pid]={'ticks':int(fields[11])+int(fields[12]),'rss_pages':int(fields[21])}
                if len(sys.argv)>2 and (pid,int(fields[19])) not in seen:
                    seen.add((pid,int(fields[19])))
                    with Path(sys.argv[2]).open('a') as ledger:
                        ledger.write(json.dumps(dict(pid=pid,start_ticks=int(fields[19]),kind='postgres-child',time=time.time()))+'\n')
        except (OSError,ValueError,IndexError): pass
    print(json.dumps({'time':time.time(),'processes':processes}),flush=True)
