"""Predeclared ABBA export experiment on this mini as-is; no quiet admission."""
import fcntl, hashlib, json, os, pathlib, re, shutil, subprocess, sys, threading, time
from measure import ROOT, WORK, REPORT, snapshot, retain

# The tail runner imports this module before launching another Python harness.
# Keep its physical Node pin idempotent: duplicate PATH entries would correctly
# invalidate the native toolchain key and turn a warm sample into a cold build.
NODE_BIN=str(pathlib.Path.home()/'.volta/tools/image/node/24.18.0/bin')
os.environ['PATH']=NODE_BIN+':'+':'.join(p for p in os.environ['PATH'].split(':') if p!=NODE_BIN)

OUT = REPORT / 'round1'
OUT.mkdir(exist_ok=True)
STATE = WORK / 'r1-state'
BINARY = WORK / 'candidate-r1-production'
PLAN = [(starter, kind, arm, index) for starter, kind in
        [('plain', 'cold'), ('social', 'cold'), ('plain', 'warm'), ('social', 'warm')]
        for index, arm in enumerate('ABBA')]

def env(arm='B'):
    result = dict(os.environ, SNAPBACK4_BIN=str(WORK/'baseline-production' if arm == 'A' else BINARY),
                  SNAPBACK4_SMOKE_DEVICE_PREFIX='sb4-nz-', XDG_STATE_HOME=str(STATE), CI='1')
    result.pop('SNAPBACK4_NATIVE_SMOKE', None)
    return result

def write(path, value): path.write_text(json.dumps(value, indent=2) + '\n')

def client_runtime_inputs():
    # Bind the exact already-built client/wasm consumed during timing, before
    # the later full suite rebuilds any generated outputs.
    files=[]
    for directory in [ROOT/'packages/snapback4/dist', ROOT/'packages/snapback4/src/wasm']:
        files += [retain(p) for p in sorted(directory.rglob('*')) if p.is_file()]
    write(OUT/'client-runtime-inputs.json',dict(sourceBase=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),files=files))

def drain_background(project):
    # A terminal proof precedes retention of older evidence. Control workloads
    # require that maintenance to finish too, so A really has no owned worker.
    with open(project/'.snapback4-witness/background.lock','a+') as lock:
        end=time.monotonic()+600
        while True:
            try:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                return
            except BlockingIOError:
                if time.monotonic()>=end: raise RuntimeError('background maintenance has not drained')
                time.sleep(.1)

class Monitor:
    def __init__(self, label):
        self.path = WORK / (label + '-host.jsonl')
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.observe, daemon=True)
    def observe(self):
        with self.path.open('w') as f:
            while not self.stop.is_set():
                ps = subprocess.check_output(['ps', '-axo', 'pid,ppid,%cpu,comm'], text=True)
                f.write(json.dumps(dict(at=time.time(), load=os.getloadavg(), processes=ps)) + '\n'); f.flush()
                self.stop.wait(2)
    def start(self): self.thread.start()
    def finish(self): self.stop.set(); self.thread.join()

def clean_native(project):
    cache = project / '.snapback4-witness'; cache.mkdir(exist_ok=True)
    with open(cache/'background.lock', 'a+') as bg, open(cache/'owner.lock', 'a+') as own:
        for lock in [bg, own]: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for child in cache.iterdir():
            # Keep dependency downloads only; no native products or intermediates.
            if child.name in ['home', 'pods-home', 'pods-cache', 'owner.lock', 'background.lock']: continue
            if child.is_dir(): shutil.rmtree(child)
            else: child.unlink()

def cleanup_devices(label):
    owners = STATE / 'snapback4/witness/simulators'; rows = []
    for file in sorted(owners.glob('*.json')):
        if file.name.endswith('.lease.json'): continue
        record = json.loads(file.read_text()); udid = record['udid']
        assert file.stem == udid and record['prefix'] == 'sb4-nz-' and record['selection'] == 'created'
        with open(owners/(udid+'.lease.json'), 'a+') as lease:
            fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
            devices = json.loads(subprocess.check_output(['xcrun','simctl','list','devices','--json']))['devices']
            found = [d for ds in devices.values() for d in ds if d['udid'] == udid]
            if found:
                assert len(found) == 1 and found[0]['name'] == record['name']
                assert any(d['udid'] == udid for d in devices.get(record['runtime'], []))
                subprocess.run(['xcrun','simctl','delete',udid], check=True)
            rows.append(dict(record=record, deleted=bool(found), at=time.time()))
            file.unlink()
    write(OUT/(label+'-cleanup.json'), rows)

def setup():
    assert hashlib.sha256((WORK/'baseline-production').read_bytes()).hexdigest() == '91e3c821deb1ed63d0142c68834f63c6ad3304419d457c2a0caeb1b7ae028cfb'
    for starter in ['plain', 'social']:
        for arm in 'AB':
            dest = WORK/f'r1-{starter}-{arm}'
            if dest.exists(): continue
            subprocess.run(['/bin/cp', '-cR', str(WORK/starter), str(dest)], check=True)
            for name in ['artifacts', 'dist', '.expo']:
                shutil.rmtree(dest/name, ignore_errors=True)
            clean_native(dest)
    write(OUT/'plan.json', dict(createdAt=time.time(), plan=PLAN,
        design='A=WD synchronous foreground export; B=NZ detached background proof. One ABBA block for each starter/cache condition. No quiet gate.',
        cache='Cold clears native snapshot/Pods/DerivedData/export cache, keeps identical dependency/download caches; warm changes only app JS after own-arm cold priming. Host/Metro caches are not flushed.',
        simulators='Every sample starts without any live device in this harness ownership store. Baseline devices deleted after each sample; candidate deletes its own device. Warm refers to native build cache, not a prebooted device.',
        binaries=[retain(WORK/'baseline-production'), retain(BINARY)],
        wrappers=[retain(WORK/'baseline-export-ios.mjs'), retain(ROOT/'packages/snapback4-expo/export-ios.mjs')] ))

def arm_wrapper(arm):
    shutil.copyfile(WORK/'baseline-export-ios.mjs' if arm == 'A' else ROOT/'packages/snapback4-expo/export-ios.mjs', WORK/'export-ios.mjs')

def latest(project):
    return pathlib.Path(json.loads((project/'artifacts/native-smoke/latest.json').read_text())['artifacts'])

def run(starter, kind, arm, index):
    label = f'r1-export-{starter}-{kind}-{index}-{arm}'
    if (OUT/(label+'.json')).exists(): return
    project = WORK/f'r1-{starter}-{arm}'; arm_wrapper(arm)
    entry = project/('App.tsx' if starter == 'plain' else 'src/client.ts')
    marker = f'{label}-{time.time_ns()}'
    entry.write_text(entry.read_text() + '\nObject.defineProperty(globalThis, "__nzSample", {configurable:true,value:' + json.dumps(marker) + '});\n')
    if kind == 'cold': clean_native(project)
    before = snapshot(); monitor = Monitor(label); monitor.start()
    log = WORK/(label+'.log'); print('START '+label, flush=True)
    started = time.time(); start = time.monotonic()
    with log.open('w') as f:
        result = subprocess.run(['npm', 'run', 'export:ios'], cwd=project, env=env(arm), stdout=f, stderr=f)
    critical = time.monotonic()-start; returned = time.time()
    waited = None
    if arm == 'B' and (project/'artifacts/native-smoke/latest.json').exists():
        folder = latest(project)
        with (WORK/(label+'-wait.log')).open('w') as f:
            waited = subprocess.run([str(BINARY), 'witness', 'status', '--wait', '--json'], cwd=project, env=env(), stdout=f, stderr=f).returncode
    else:
        folders = list((project/'artifacts/native-smoke').glob('*/export.lock'))
        folder = max(folders, key=lambda p:p.stat().st_mtime).parent
    total = time.monotonic()-start
    monitor.finish(); after = snapshot()
    def read(name):
        p = folder/name
        return json.loads(p.read_text()) if p.exists() else None
    receipt = read('smoke-ios-run.json') or {}
    meta = json.loads((project/'dist/metadata.json').read_text()) if (project/'dist/metadata.json').exists() else {}
    bundle = project/'dist'/meta['fileMetadata']['ios']['bundle'] if meta else None
    row = dict(label=label, starter=starter, kind=kind, arm=arm, index=index, startedAt=started,
        returnedAt=returned, criticalSeconds=critical, totalSeconds=total, afterReturnSeconds=total-critical,
        status=result.returncode, waitStatus=waited, before=before, after=after, artifacts=str(folder),
        result=read('result.json'), nativeDurationMs=receipt.get('durationMs'), cache=receipt.get('nativeCache'),
        error=receipt.get('error'), simulator=receipt.get('simulator'), deadline=read('preparation-deadline.json'),
        phases=read('preparation-phases.json'), segments={k:v.get('status') for k,v in receipt.get('segments',{}).items()},
        exportHash=hashlib.sha256(bundle.read_bytes()).hexdigest() if bundle else None,
        loadedHash=receipt.get('installed',{}).get('javascript',{}).get('sha256'))
    row['evidence'] = [retain(log), retain(monitor.path)] + [retain(p) for p in folder.iterdir() if p.is_file() and p.suffix in ['.json','.jsonl','.log','.mp4','.png']]
    write(OUT/(label+'.json'), row)
    cleanup_devices(label)
    print(json.dumps({k:row[k] for k in ['label','criticalSeconds','totalSeconds','status','waitStatus','error','segments','cache','deadline']}), flush=True)
    # Keep every failed sample and the predeclared order; never silently retry.
    # A warm sample after a failed cold prime is labelled by its actual cache receipt.

if __name__ == '__main__':
    setup()
    for sample in PLAN: run(*sample)
