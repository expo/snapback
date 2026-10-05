"""Run remaining measurements and the canonical suite sequentially on this Mac."""
import os, subprocess, time
from round1 import ROOT, OUT, write

directory=OUT.parent
stages=[
    ('warm-interference',['python3',str(directory/'round1-interference.py')]),
    ('cold-interference',['python3',str(directory/'round1-cold-interference.py')]),
    ('full-suite',['bash','snapback4/scripts/test.sh']),
]
environment=dict(os.environ,LIBSQLITE3_FLAGS='-USQLITE_ENABLE_MEMORY_MANAGEMENT')
environment.pop('SNAPBACK4_BIN',None)
records=[]
for label,command in stages:
    log='/tmp/sb4-nz-r1-'+label+'.log'; started=time.time(); start=time.monotonic()
    record=dict(label=label,command=command,log=log,startedAt=started,state='running')
    records.append(record);write(OUT/'tail-stages.json',records)
    print('START '+label,flush=True)
    with open(log,'w') as f: result=subprocess.run(command,cwd=ROOT.parent,env=environment,stdout=f,stderr=f)
    record.update(state='complete',status=result.returncode,seconds=time.monotonic()-start,finishedAt=time.time())
    write(OUT/'tail-stages.json',records);print(record,flush=True)
    if result.returncode: raise SystemExit(result.returncode)
