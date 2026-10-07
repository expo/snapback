#!/usr/bin/env python3
"""Run one qualified command with this lane's CPU/profile and retain its exit."""
import datetime, json, os, pathlib, subprocess, sys, time
report = pathlib.Path(__file__).resolve().parent
root = report.parents[2]
name, *command = sys.argv[1:]
env = os.environ | {'CARGO_BUILD_JOBS':'8','CARGO_PROFILE_TEST_DEBUG':'0','CARGO_PROFILE_DEV_DEBUG':'0','CARGO_INCREMENTAL':'0','LIBSQLITE3_FLAGS':'-USQLITE_ENABLE_MEMORY_MANAGEMENT'}
cpus = '7,8,9,10,12,15,16,19,22,24,25,29,37,38,41,42,43,44,47,50,55,56,57,58'
started = datetime.datetime.now(datetime.timezone.utc).isoformat(); before=time.monotonic()
with (report / (name+'.log')).open('wb') as log:
 result = subprocess.run(['taskset','-c',cpus,*command],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
receipt={'command':command,'cwd':str(root),'cpus':cpus,'started':started,'seconds':round(time.monotonic()-before,3),'exit':result.returncode}
(report / (name+'.json')).write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt),flush=True)
sys.exit(result.returncode)
