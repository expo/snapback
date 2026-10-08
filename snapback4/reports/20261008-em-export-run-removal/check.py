#!/usr/bin/env python3
"""Record an affected check without losing failures or their command/environment."""
import json,os,subprocess,sys,time
from pathlib import Path
out=Path(__file__).resolve().parent
workspace=out.parents[1]
name,*cmd=sys.argv[1:]
env={**os.environ,'LIBSQLITE3_FLAGS':'-USQLITE_ENABLE_MEMORY_MANAGEMENT','CARGO_BUILD_JOBS':'6','SNAPBACK4_EXPORT_TEST_BINARY':str(workspace/'target/em-r11-final/debug/snapback4'),'SNAPBACK4_MAINTENANCE_EVIDENCE':str(out/(name+'-snapshots'))}
inherited_umask=os.umask(0o077)
start=time.monotonic()
with (out/(name+'.log')).open('w') as log:
 result=subprocess.run(cmd,cwd=workspace,env=env,stdout=log,stderr=subprocess.STDOUT,umask=inherited_umask)
receipt=dict(name=name,command=cmd,exitCode=result.returncode,seconds=time.monotonic()-start,childUmask=oct(inherited_umask))
(out/(name+'.json')).write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt),flush=True)
sys.exit(result.returncode)
