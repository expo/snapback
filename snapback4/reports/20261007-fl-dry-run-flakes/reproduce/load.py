import subprocess, pathlib, time, json, os
root=pathlib.Path.cwd()
out=root/'reports/20261007-fl-dry-run-flakes/evidence'
bin=next(p for p in (root/'target/debug/deps').glob('dev_refusals-*') if p.is_file() and os.access(p, os.X_OK))
cpus='80,81'
load=[]
records=[]
try:
    for i in range(4):
        load.append(subprocess.Popen(['taskset','-c',cpus,'python3','-c','while True: pass'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL))
    print(json.dumps({'cpus':cpus,'busyLoops':len(load),'ownedLoadPids':[p.pid for p in load]}),flush=True)
    with (out/'loaded-runs.log').open('w') as log:
        for i in range(1,21):
            for name,cmd in [('empty',[str(bin),'--exact','empty_read_evidence_is_top_level_proved_and_opt_in_only','--nocapture']),('custody',['node','--test','--test-name-pattern=blocked retention has bounded custody: before (SIGKILL|SIGTERM|supersede)$','packages/snapback4/test/export-background.test.mjs'])]:
                start=time.monotonic(); r=subprocess.run(['taskset','-c',cpus]+cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=420)
                record={'round':i,'test':name,'exit':r.returncode,'seconds':round(time.monotonic()-start,3)}
                records.append(record); print(json.dumps(record),flush=True)
                log.write(json.dumps(record)+'\n'+r.stdout+'\n');log.flush()
finally:
    for p in load: p.terminate()
    for p in load: p.wait()
    (out/'loaded-summary.json').write_text(json.dumps({'cpus':cpus,'busyLoops':4,'runs':records,'loadReaped':all(p.poll() is not None for p in load)},indent=2)+'\n')
raise SystemExit(any(r['exit'] for r in records))
