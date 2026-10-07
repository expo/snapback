#!/usr/bin/env python3
"""Lane-local Linux stress/repetition driver. All children inherit taskset affinity."""
import argparse, concurrent.futures, hashlib, json, os, pathlib, shutil, subprocess, sys, time

p = argparse.ArgumentParser()
p.add_argument('--out', required=True)
p.add_argument('--rounds', type=int, default=30)
p.add_argument('--jobs', type=int, default=1)
p.add_argument('--cpus', default='80-83')
p.add_argument('--load', type=int, default=4)
p.add_argument('--io-workers', type=int, default=1)
p.add_argument('--burst-seconds', type=float, default=0, help='Alternate CPU/disk work and idle phases; zero means continuous')
p.add_argument('--binary', default='target/debug/snapback4')
p.add_argument('--test-file', default='packages/snapback4/test/export-background.test.mjs')
p.add_argument('--pattern', default=r'maintenance crash matrix: publication-handoff \(off, next Expo fails\)|failed Expo exports and dead wrapper journals never occupy keep slots \(off\)|skipped maintenance never blocks publication and drains under deadline \(off\)')
p.add_argument('--keep-going', action='store_true')
a=p.parse_args()
out=pathlib.Path(a.out).resolve(); out.mkdir(parents=True, exist_ok=True)
affinity=['taskset','-c',a.cpus]
children=[]
failed=False
binary=pathlib.Path(a.binary)
digest=hashlib.sha256(binary.read_bytes()).hexdigest()
pinned=pathlib.Path('target/em/binaries',digest,'snapback4').resolve()
pinned.parent.mkdir(parents=True,exist_ok=True)
if not pinned.exists(): shutil.copy2(binary,pinned)
sources=[a.test_file,'packages/snapback4/test/helpers/maintenance-evidence.mjs']
(out/'host.json').write_text(json.dumps(dict(host=os.uname().nodename, cpus=a.cpus, loadWorkers=a.load, jobs=a.jobs, start=time.time(), binarySha256=digest, pinned=str(pinned), sources={s:hashlib.sha256(pathlib.Path(s).read_bytes()).hexdigest() for s in sources}, args=vars(a)),indent=2))
io_files=[]
try:
    for i in range(a.load):
        children.append(subprocess.Popen(affinity+[sys.executable,'-c','import hashlib,sys,time; b=bytes(1048576); burst=float(sys.argv[1])\nwhile True:\n if burst and int(time.monotonic()/burst)%2: time.sleep(.02)\n else: hashlib.sha256(b).digest()',str(a.burst_seconds)]))
    for i in range(a.io_workers):
        io=out/f'io-load-{i}'; io_files.append(io)
        children.append(subprocess.Popen(affinity+[sys.executable,'-c',"import os,sys,time; f=open(sys.argv[1],'w+b',buffering=0); b=bytes(1024*1024); burst=float(sys.argv[2])\nwhile True:\n if burst and int(time.monotonic()/burst)%2: time.sleep(.02); continue\n f.seek(0); f.write(b); os.fsync(f.fileno()); f.seek(0); f.read(len(b)); time.sleep(.02)",str(io),str(a.burst_seconds)]))
    (out/'load-pids.json').write_text(json.dumps([child.pid for child in children]))
    def run(n):
        env={**os.environ,'SNAPBACK4_EXPORT_TEST_BINARY':str(pinned),'SNAPBACK4_DEBUG_RETENTION':'1','SNAPBACK4_MAINTENANCE_EVIDENCE':str(out/f'run-{n:03d}')}
        started=time.time()
        with (out/f'run-{n:03d}.log').open('w') as log:
            proc=subprocess.Popen(affinity+['node','--test','--test-reporter=tap','--test-name-pattern='+a.pattern,a.test_file],env=env,stdout=log,stderr=subprocess.STDOUT)
            code=proc.wait()
        result=dict(run=n,code=code,elapsed=time.time()-started)
        with (out/'results.jsonl').open('a') as f: f.write(json.dumps(result)+'\n')
        print(json.dumps(result),flush=True)
        return code
    with concurrent.futures.ThreadPoolExecutor(max_workers=a.jobs) as pool:
        for start in range(1,a.rounds+1,a.jobs):
            codes=list(pool.map(run,range(start,min(start+a.jobs,a.rounds+1))))
            failed = failed or any(codes)
            if any(codes) and not a.keep_going: break
finally:
    for child in children: child.terminate()
    for child in children: child.wait()
    for io in io_files: io.unlink(missing_ok=True)
sys.exit(1 if failed else 0)
