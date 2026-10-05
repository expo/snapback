"""Integrated warm native round trips on this mini; prime the changed CLI key first."""
import hashlib, json, pathlib, shutil, subprocess, time
import round1 as shared
from measure import ROOT, WORK, REPORT, retain, snapshot

OUT = REPORT/'round2'
BINARY = WORK/'candidate-r2-debug'
STATE = WORK/'r2-state'
shared.OUT, shared.BINARY, shared.STATE = OUT, BINARY, STATE

def run(starter, phase):
    label = f'r2-{starter}-{phase}'
    assert not (OUT/(label+'.json')).exists(), 'preserve all attempts; choose an explicit new label'
    project = WORK/f'r1-{starter}-B'
    shared.drain_background(project)
    shutil.copyfile(ROOT/'packages/snapback4-expo/export-ios.mjs', WORK/'export-ios.mjs')
    entry = project/('App.tsx' if starter == 'plain' else 'src/client.ts')
    marker = label+'-'+str(time.time_ns())
    entry.write_text(entry.read_text()+'\nObject.defineProperty(globalThis,"__nzSample",{configurable:true,value:'+json.dumps(marker)+'});\n')
    environment = shared.env()
    before = snapshot(); monitor = shared.Monitor(label); monitor.start()
    log = WORK/(label+'.log'); waitlog = WORK/(label+'-wait.log')
    print('START '+label, flush=True)
    started = time.time(); start = time.monotonic()
    with log.open('w') as stream:
        status = subprocess.run(['npm','run','export:ios'], cwd=project, env=environment, stdout=stream, stderr=stream).returncode
    critical = time.monotonic()-start
    with waitlog.open('w') as stream:
        waitstatus = subprocess.run([str(BINARY),'witness','status','--wait','--json'], cwd=project, env=environment, stdout=stream, stderr=stream).returncode
    completed = time.monotonic()-start
    folder = shared.latest(project)
    shared.drain_background(project)
    drained = time.monotonic()-start
    monitor.finish(); after = snapshot()
    def read(name):
        p=folder/name
        return json.loads(p.read_text()) if p.exists() else None
    receipt = read('smoke-ios-run.json') or {}
    meta = json.loads((project/'dist/metadata.json').read_text())
    bundle = project/'dist'/meta['fileMetadata']['ios']['bundle']
    row = dict(label=label,starter=starter,phase=phase,startedAt=started,criticalSeconds=critical,
        completionSeconds=completed,afterReturnSeconds=completed-critical,drainedSeconds=drained,
        status=status,waitStatus=waitstatus,artifacts=str(folder),before=before,after=after,
        result=read('result.json'),nativeDurationMs=receipt.get('durationMs'),cache=receipt.get('nativeCache'),
        error=receipt.get('error'),simulator=receipt.get('simulator'),deadline=read('preparation-deadline.json'),
        phases=read('preparation-phases.json'),segments={k:v.get('status') for k,v in receipt.get('segments',{}).items()},
        exportHash=hashlib.sha256(bundle.read_bytes()).hexdigest(),loadedHash=receipt.get('installed',{}).get('javascript',{}).get('sha256'))
    row['evidence'] = [retain(log),retain(waitlog),retain(monitor.path)] + [retain(p) for p in folder.iterdir() if p.is_file() and p.suffix in ['.json','.jsonl','.log','.mp4','.png']]
    shared.write(OUT/(label+'.json'),row)
    shared.cleanup_devices(label)
    print(json.dumps({k:row[k] for k in ['label','criticalSeconds','completionSeconds','drainedSeconds','status','waitStatus','cache','error','segments']}),flush=True)
    assert status==0 and waitstatus==0 and row['segments']==dict(prime='passed',offline='passed',restart='passed')
    assert row['exportHash']==row['loadedHash']
    if phase=='warm': assert row['cache']['hit'] is True, 'warm qualification requires an actual cache-hit receipt'

if __name__=='__main__':
    shared.write(OUT/'measurement-plan.json',dict(at=time.time(),binary=retain(BINARY),profile='dev/unoptimized',
        design='Sequential plain engine-prime/warm then social engine-prime/warm after the retained failed old-engine plain prime. Audited framework and CLI integration change native keys, so priming is separate from warm samples. No native cache cleared; warm changes only JavaScript. No quiet admission.',
        dependencies='Existing audited NX 0.4.11 fixtures, Expo 57.0.22, with merged-source native engine framework only. Complete inventory delta audited and pinned in framework-audit.json; no audit bypass. Does not qualify the published 0.4.12 dependency tree.',
        environment={k:shared.env()[k] for k in ['PATH','XDG_STATE_HOME','SNAPBACK4_SMOKE_DEVICE_PREFIX','SNAPBACK4_BIN']},
        projects=[dict(path=str(WORK/f'r1-{s}-B'),package=retain(WORK/f'r1-{s}-B/package.json'),lock=retain(WORK/f'r1-{s}-B/package-lock.json')) for s in ['plain','social']]))
    for starter in ['plain','social']:
        for phase in ['engine-prime','warm']: run(starter,phase)
