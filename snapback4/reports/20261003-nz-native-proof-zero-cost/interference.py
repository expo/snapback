"""Quiet-host, bracketed six-file client-pool / native-build comparison."""
import json, os, pathlib, re, resource, subprocess, threading, time
from measure import ROOT, WORK, REPORT, quiet, retain, snapshot
PROJECT = WORK/'functional'
BINARY = WORK/'candidate-production'
ENV = dict(os.environ, SNAPBACK4_BIN=str(BINARY), SNAPBACK4_SMOKE_DEVICE_PREFIX='sb4-nz-',
           XDG_STATE_HOME=str(WORK/'functional-state'), CI='1')
ENV.pop('SNAPBACK4_NATIVE_SMOKE',None)
FILES = ['client-seams', 'client-lifecycle', 'device-residency', 'keep-device',
         'delivery-clients', 'subscription-pressure-device']
COMMAND = ['node','--test','--test-concurrency=6'] + [f'packages/snapback4/test/{f}.test.mjs' for f in FILES]
ROWS = []
def latest():
    return pathlib.Path(json.loads((PROJECT/'artifacts/native-smoke/latest.json').read_text())['artifacts'])
def foreground(label, smoke=None):
    before = quiet() if smoke is None else snapshot()
    log = WORK/f'interference-{label}.log'
    observations=WORK/f'interference-{label}-host.jsonl'; stop=threading.Event()
    def observe():
        with observations.open('w') as f:
            while not stop.is_set():
                ps=subprocess.check_output(['ps','-axo','pid,ppid,%cpu,comm'],text=True)
                f.write(json.dumps(dict(at=time.time(),load=os.getloadavg(),processes=ps))+'\n'); f.flush()
                stop.wait(2)
    monitor=threading.Thread(target=observe,daemon=True); monitor.start()
    cpu = resource.getrusage(resource.RUSAGE_CHILDREN); start=time.monotonic(); wall=time.time()
    try:
        with log.open('w') as f: result=subprocess.run(COMMAND,cwd=ROOT,env=ENV,stdout=f,stderr=f)
        seconds=time.monotonic()-start; after=resource.getrusage(resource.RUSAGE_CHILDREN)
    finally: stop.set(); monitor.join()
    row=dict(label=label,startedAt=wall,seconds=seconds,status=result.returncode,
             childCpuSeconds=after.ru_utime+after.ru_stime-cpu.ru_utime-cpu.ru_stime,
             before=before,after=snapshot(),smoke=str(smoke) if smoke else None,evidence=[retain(log),retain(observations)])
    row['unrelatedRustCompilers']=sorted({line for sample in observations.read_text().splitlines() for line in json.loads(sample)['processes'].splitlines() if re.search(r'/(cargo|rustc)$',line)})
    row['unrelatedPerfPowerServices'] = sorted({line for sample in observations.read_text().splitlines() for line in json.loads(sample)['processes'].splitlines() if line.rstrip().endswith('/PerfPowerServices') and float(line.split()[2]) >= 30})
    row['quietAdmitted'] = not row['unrelatedRustCompilers'] and not row['unrelatedPerfPowerServices']
    if smoke:
        final=smoke/'result.json'
        row['resultAtWorkloadEnd']=json.loads(final.read_text()) if final.exists() else None
    ROWS.append(row); (REPORT/'interference.json').write_text(json.dumps(dict(command=COMMAND,rows=ROWS),indent=2)+'\n')
    print(json.dumps({k:row[k] for k in ['label','seconds','childCpuSeconds','status']}),flush=True)
    if not row['quietAdmitted']: raise RuntimeError('unrelated compiler or PerfPowerServices overlapped; sample retained but not qualified')
    if result.returncode: raise RuntimeError('foreground workload failed; sample retained')
def run():
    for i in range(3): foreground(f'before-{i}')
    # Force a real native build while retaining dependency-download caches. A
    # changed native display name is a legitimate input, not a cache bypass.
    config=PROJECT/'app.json'; original=config.read_text(); changed=json.loads(original)
    changed['expo']['name'] += ' NZ interference'
    config.write_text(json.dumps(changed,indent=2)+'\n')
    quiet()
    with (WORK/'interference-export.log').open('w') as f:
        result=subprocess.run(['npm','run','export:ios'],cwd=PROJECT,env=ENV,stdout=f,stderr=f)
    if result.returncode: raise RuntimeError('interference export failed')
    smoke=latest()
    try:
        # This command log is opened immediately before the actual compile.
        while not (smoke/'xcode-build.log').exists():
            if (smoke/'result.json').exists(): raise RuntimeError('native smoke ended before compile')
            time.sleep(.2)
        for i in range(3): foreground(f'background-build-{i}',smoke)
        with (WORK/'interference-wait.log').open('w') as f:
            proof=subprocess.run([str(BINARY),'witness','status','--wait','--json'],cwd=PROJECT,env=ENV,stdout=f,stderr=f)
        if proof.returncode: raise RuntimeError('background proof failed; samples retained')
    finally:
        # Preserve custody even after foreground failure; let the own native
        # run finish before changing its project input back.
        subprocess.run([str(BINARY),'witness','status','--wait','--json'],cwd=PROJECT,env=ENV,stdout=subprocess.DEVNULL)
        config.write_text(original)
    for i in range(3): foreground(f'after-{i}')
    probes=[]
    for mode in ['foreground','background']:
        for i in range(3):
            quiet()
            command=([str(WORK/'cpu-probe')] if mode=='foreground' else ['/usr/sbin/taskpolicy','-b','-c','background',str(WORK/'cpu-probe')])
            probes.append(dict(mode=mode,sample=i,result=json.loads(subprocess.check_output(command,text=True))))
    (REPORT/'cpu-placement.json').write_text(json.dumps(probes,indent=2)+'\n')
if __name__=='__main__': run()
