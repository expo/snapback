"""Quiet-host export timings; source/receipts stay in this lane's evidence archive."""
import ctypes, fcntl, hashlib, json, os, pathlib, re, shutil, subprocess, sys, time, threading
ROOT = pathlib.Path(__file__).resolve().parents[2]
REPORT = pathlib.Path(__file__).resolve().parent
WORK = ROOT / 'target/nz'
ARCHIVE = pathlib.Path.home() / 'sb4-np/evidence-archive/20261003-nz-native-proof-zero-cost/blobs'
ARCHIVE.mkdir(parents=True, exist_ok=True)
os.environ['PATH'] = str(pathlib.Path.home()/'.volta/tools/image/node/24.18.0/bin') + ':' + os.environ['PATH']
def retain(path):
    data = path.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    dst = ARCHIVE / sha
    if not dst.exists(): dst.write_bytes(data)
    return dict(path=str(path), sha256=sha, bytes=len(data))
def snapshot():
    ps = subprocess.check_output(['ps', '-axo', 'pid,ppid,%cpu,comm'], text=True)
    compilers = [line for line in ps.splitlines() if re.search(r'/(cargo|rustc|xcodebuild)$', line)]
    commands = subprocess.check_output(['ps','-axo','pid,command'], text=True)
    background_jobs = [int(s.split()[0]) for s in commands.splitlines()[1:] if ' witness background-worker ' in s]
    # Host counters avoid top's per-process power queries on this busy-process
    # Mac. The observer should not itself induce PerfPowerServices CPU work.
    lib = ctypes.CDLL('/usr/lib/libSystem.B.dylib')
    def ticks():
        counts = (ctypes.c_uint32*4)(); size = ctypes.c_uint32(4)
        assert lib.host_statistics(lib.mach_host_self(), 3, counts, ctypes.byref(size)) == 0
        return list(counts)
    first = ticks(); time.sleep(1); last = ticks()
    delta = [b-a for a,b in zip(first,last)]
    idle = 100*delta[2]/sum(delta)
    return dict(at=time.time(), load=os.getloadavg(), idlePercent=idle, compilers=compilers, backgroundJobs=background_jobs,
                busy=sorted(ps.splitlines()[1:], key=lambda s: float(s.split()[2]), reverse=True)[:10])
def quiet():
    good = 0
    while good < 3:
        s = snapshot()
        s['paused'] = (WORK/'pause-measurements').exists()
        s['admitted'] = s['load'][0] < 6 and s['idlePercent'] >= 90 and all(float(p.split()[2]) < 30 for p in s['busy']) and not s['compilers'] and not s['backgroundJobs'] and not s['paused']
        with (WORK/'quiet.jsonl').open('a') as f: f.write(json.dumps(s)+'\n')
        good = good + 1 if s['admitted'] else 0
        print(f"quiet {good}/3: load={s['load'][0]:.2f}, idle={s['idlePercent']:.1f}%, compilers={len(s['compilers'])}, paused={s['paused']}", flush=True)
        if good < 3: time.sleep(10)
    return s
def run(phase, starter, kind, index=0):
    project = WORK/starter
    binary = WORK/('baseline-production' if phase == 'before' else 'candidate-production')
    env = dict(os.environ, SNAPBACK4_BIN=str(binary), SNAPBACK4_SMOKE_DEVICE_PREFIX='sb4-nz-',
               XDG_STATE_HOME=str(WORK/'state'), CI='1')
    env.pop('SNAPBACK4_NATIVE_SMOKE',None)
    entry = project/('App.tsx' if starter == 'plain' else 'src/client.ts')
    marker = f'NZ {phase} {starter} {kind} {index} {time.time_ns()}'
    entry.write_text(entry.read_text()+f'\nObject.defineProperty(globalThis, "__nzSample", {{configurable:true,value:{json.dumps(marker)}}});\n')
    if kind == 'cold':
        # Keep only the six verified download archives, not any compiled state.
        cache = project/'.snapback4-witness'
        locks = [open(cache/name,'a+') for name in ['background.lock','owner.lock']]
        for lock in locks: fcntl.flock(lock,fcntl.LOCK_EX)
        for child in cache.iterdir():
            if child.name in ['pods-home', 'pods-cache', 'home', 'owner.lock', 'background.lock']: continue
            if child.is_dir(): shutil.rmtree(child)
            else: child.unlink()
        for lock in locks: lock.close()
    before = quiet()
    label = f'{phase}-{starter}-{kind}-{index}'
    log = WORK/f'{label}.log'
    print('START '+label, flush=True)
    observations = WORK/f'{label}-host.jsonl'
    stop = threading.Event()
    def observe():
        with observations.open('w') as f:
            while not stop.is_set():
                ps = subprocess.check_output(['ps','-axo','pid,ppid,%cpu,comm'], text=True)
                f.write(json.dumps(dict(at=time.time(), load=os.getloadavg(), processes=ps))+'\n'); f.flush()
                stop.wait(2)
    monitor = threading.Thread(target=observe, daemon=True); monitor.start()
    start = time.monotonic()
    with log.open('w') as output:
        result = subprocess.run(['npm','run','export:ios'], cwd=project, env=env, stdout=output, stderr=output)
    critical = time.monotonic()-start
    published = time.time()
    if phase == 'after':
        with (WORK/f'{label}-wait.log').open('w') as output:
            waited = subprocess.run([str(binary),'witness','status','--wait','--json'], cwd=project, env=env, stdout=output, stderr=output)
        wait_status = waited.returncode
        latest = json.loads((project/'artifacts/native-smoke/latest.json').read_text())
        folder = pathlib.Path(latest['artifacts'])
    else:
        wait_status = None
        folder = max((project/'artifacts/native-smoke').glob('*/smoke-ios-run.json'), key=lambda p:p.stat().st_mtime).parent
    total = time.monotonic()-start
    stop.set(); monitor.join()
    receipt_path = folder/'smoke-ios-run.json'
    receipt = json.loads(receipt_path.read_text()) if receipt_path.exists() else {}
    meta = json.loads((project/'dist/metadata.json').read_text()) if (project/'dist/metadata.json').exists() else {}
    bundle = project/'dist'/meta['fileMetadata']['ios']['bundle'] if meta else None
    row = dict(phase=phase, starter=starter, kind=kind, sample=index, criticalSeconds=critical, totalSeconds=total,
               afterReturnSeconds=total-critical, status=result.returncode, waitStatus=wait_status, returnedAt=published,
               before=before, after=snapshot(), receipt=str(receipt_path), nativeDurationMs=receipt.get('durationMs'),
               cache=receipt.get('nativeCache'), error=receipt.get('error'), simulator=receipt.get('simulator'),
               segments={k:v.get('status') for k,v in receipt.get('segments',{}).items()},
               exportHash=hashlib.sha256(bundle.read_bytes()).hexdigest() if bundle else None,
               loadedHash=receipt.get('installed',{}).get('javascript',{}).get('sha256'))
    row['unrelatedRustCompilers'] = sorted({line for sample in observations.read_text().splitlines() for line in json.loads(sample)['processes'].splitlines() if re.search(r'/(cargo|rustc)$',line)})
    row['unrelatedPerfPowerServices'] = sorted({line for sample in observations.read_text().splitlines() for line in json.loads(sample)['processes'].splitlines() if line.rstrip().endswith('/PerfPowerServices') and float(line.split()[2]) >= 30})
    row['quietAdmitted'] = not row['unrelatedRustCompilers'] and not row['unrelatedPerfPowerServices']
    row['evidence'] = [retain(log), retain(observations)] + [retain(p) for p in folder.iterdir() if p.is_file() and p.suffix in ['.json','.jsonl','.log','.mp4','.png']]
    out = REPORT/f'{phase}-timings.json'
    rows = json.loads(out.read_text()) if out.exists() else []
    rows.append(row); out.write_text(json.dumps(rows,indent=2)+'\n')
    print(json.dumps({k:row[k] for k in ['phase','starter','kind','criticalSeconds','totalSeconds','status','error','segments','cache']}), flush=True)
    if not row['quietAdmitted']: raise RuntimeError('unrelated compiler or PerfPowerServices overlapped sample; retained but not qualified')
    if result.returncode or (wait_status is not None and wait_status) or len(row['segments']) != 3 or any(s != 'passed' for s in row['segments'].values()):
        raise RuntimeError(f'export/smoke failed; retained {label}')
    return row
def delete_devices():
    # Only this harness's private ownership store; never select by prefix alone.
    owners = WORK/'state/snapback4/witness/simulators'
    rows = []
    for file in sorted(owners.glob('*.json')):
        if file.name.endswith('.lease.json'): continue
        record = json.loads(file.read_text()); udid = record['udid']
        assert file.stem == udid and record['prefix'] == 'sb4-nz-' and record['selection'] == 'created'
        with open(owners/(udid+'.lease.json'),'a+') as lease:
            fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
            devices = json.loads(subprocess.check_output(['xcrun','simctl','list','devices','--json']))['devices']
            found = [d for ds in devices.values() for d in ds if d['udid']==udid]
            if found:
                assert len(found)==1 and found[0]['name']==record['name']
                assert any(d['udid']==udid for d in devices.get(record['runtime'],[]))
                subprocess.run(['xcrun','simctl','delete',udid],check=True)
            rows.append(dict(record=record,deleted=bool(found),at=time.time()))
            file.unlink()
    output=REPORT/'measurement-device-cleanup.json'
    old=json.loads(output.read_text()) if output.exists() else []
    output.write_text(json.dumps(old+rows,indent=2)+'\n')

if __name__ == '__main__':
    (WORK/'measurement.pid').write_text(str(os.getpid()))
    phase = sys.argv[1]
    assert phase in ['before','after']
    source = WORK/'baseline-export-ios.mjs' if phase == 'before' else ROOT/'packages/snapback4-expo/export-ios.mjs'
    shutil.copyfile(source,WORK/'export-ios.mjs')
    try:
        for starter in ['plain','social']:
            run(phase, starter, 'cold')
            for i in range(3): run(phase, starter, 'warm', i)
    finally: delete_devices()
