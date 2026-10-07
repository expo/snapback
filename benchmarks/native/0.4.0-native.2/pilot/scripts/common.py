"""Packet custody and bounded process helpers. No import has launch side effects."""
import fcntl, hashlib, json, os, platform, signal, socket, stat, subprocess, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UDID = '3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B'
BACKENDS = ('snapback4', 'convex')
MILESTONES = ('m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm8')
PORTS = {'snapback4': (49540, 49559), 'convex': (49560, 49579)}
NATIVE = ROOT / 'inputs/components/native-0.4.0-native.2'
WEB = ROOT / 'inputs/components/web-0.3.8-m8'

def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''): h.update(b)
    return h.hexdigest()

def put(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x') as f:
        f.write(value if isinstance(value, str) else json.dumps(value, indent=2) + '\n')

def read(path): return json.loads(Path(path).read_text())

def record(path, **event):
    with Path(path).open('a') as f:
        f.write(json.dumps({'at': time.time(), **event}) + '\n'); f.flush(); os.fsync(f.fileno())

def inventory(root):
    root = Path(root); result = {}
    def walk(p):
        s = p.lstat(); row = {'mode': stat.S_IMODE(s.st_mode)}
        if p.is_symlink(): row.update(kind='symlink', target=os.readlink(p))
        elif p.is_dir(): row['kind'] = 'directory'
        elif p.is_file(): row.update(kind='file', bytes=s.st_size, sha256=sha(p))
        else: raise RuntimeError('special-file:' + str(p))
        result[str(p.relative_to(root))] = row
        if row['kind'] == 'directory':
            for child in sorted(p.iterdir()): walk(child)
    walk(root); return result

def readonly(root):
    for p in sorted(Path(root).rglob('*'), reverse=True):
        if not p.is_symlink(): p.chmod(0o555 if p.is_dir() or p.stat().st_mode & 0o111 else 0o444)
    Path(root).chmod(0o555)

def host_check():
    if platform.system() != 'Darwin' or socket.gethostname().split('.')[0] != 'MacMini-Apt101-M5-A':
        raise RuntimeError('Apartment-mini-only')
    node = subprocess.check_output(['node', '--version'], text=True).strip()
    xcode = subprocess.check_output(['xcodebuild', '-version'], text=True)
    if node != 'v24.18.0' or xcode.strip() != 'Xcode 27.0\nBuild version 27A266a':
        raise RuntimeError('toolchain-drift:' + node + ':' + xcode.strip())

def lock(name):
    path = ROOT / 'runtime' / name; path.parent.mkdir(exist_ok=True)
    f = path.open('a')
    try: fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError: raise RuntimeError('serial-lock-held:' + name)
    return f

def free_ports(backend):
    for port in [*range(PORTS[backend][0], PORTS[backend][1] + 1), 49492]:
        with socket.socket() as s:
            s.settimeout(.2)
            if s.connect_ex(('127.0.0.1', port)) == 0: raise RuntimeError('occupied-port:' + str(port))

def stop(p):
    if p is None: return
    from processes import process_table
    # A leader can exit before a TERM-resistant child. Wait for the entire
    # group we created, and escalate even when p.wait() already succeeded.
    for sig, seconds in [(signal.SIGTERM, 10), (signal.SIGKILL, 5)]:
        deadline = time.monotonic() + seconds
        while True:
            p.poll()
            members = [r for r in process_table().values()
                       if r['pgid'] == p.pid and not r['state'].startswith('Z')]
            if not members: p.wait(timeout=5); return
            try: os.killpg(p.pid, sig)
            except ProcessLookupError: pass
            if time.monotonic() >= deadline: break
            time.sleep(.1)
    raise RuntimeError('owned-process-group-cleanup-incomplete:' + str(p.pid))

def run(argv, cwd, out, env=None, timeout=3600):
    start = time.time(); p = None; code = None; error = None
    with Path(out).open('xb') as f:
        try:
            p = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                 stdout=f, stderr=subprocess.STDOUT, start_new_session=True)
            put(str(out) + '.start.json', {'argv': argv, 'cwd': str(cwd), 'at': start, 'pid': p.pid})
            code = p.wait(timeout=timeout)
        except BaseException as e: error = e
        finally:
            stop(p)
            if p is not None and code is None: code = p.returncode
    put(str(out) + '.json', {'argv': argv, 'cwd': str(cwd), 'start': start, 'end': time.time(),
                            'wallSeconds': time.time() - start, 'exitCode': code,
                            'pid': p.pid if p else None, 'error': str(error) if error else None})
    if error: raise error
    if code: raise RuntimeError('command-failed:' + str(out))

def clone(source, target, receipt):
    before = inventory(source); put(str(receipt) + '.before.json', before)
    run(['/bin/cp', '-cRp', str(source), str(target)], ROOT, str(receipt) + '.copy.log')
    after, copied = inventory(source), inventory(target)
    put(str(receipt) + '.after.json', after); put(str(receipt) + '.clone.json', copied)
    good = before == after == copied
    put(str(receipt) + '.json', {'verified': good, 'source': str(source), 'snapshot': str(target),
                               'entries': len(copied), 'at': time.time()})
    if not good: raise RuntimeError('custody-mismatch')

def runner_config():
    if not (ROOT / 'runtime/runner.json').is_file():
        raise RuntimeError('SETUP FAILURE: qualified XCTest runner missing; restore its matching bundle/xctestrun and runtime/runner.json before launching builders')
    config = read(ROOT / 'runtime/runner.json')
    binary = Path(config['binary']); xctestrun = Path(config['xctestrun'])
    if sha(binary) != read(NATIVE / 'QUALIFIED.json')['driverBinarySha256']:
        raise RuntimeError('qualified-runner-binary-mismatch')
    import plistlib
    value = plistlib.loads(xctestrun.read_bytes())
    # A runner receipt must identify the actual TestBundlePath in this xctestrun,
    # not an unrelated file whose digest happens to match the qualification pin.
    targets = []
    def descend(v):
        if isinstance(v, dict):
            if 'TestBundlePath' in v: targets.append(v)
            for x in v.values(): descend(x)
        elif isinstance(v, list):
            for x in v: descend(x)
    descend(value)
    if len(targets) != 1: raise RuntimeError('runner-target-count')
    target = targets[0]
    def resolve(s):
        s = s.replace('__TESTROOT__', str(xctestrun.parent))
        s = s.replace('__TESTHOST__', target.get('TestHostPath', '').replace('__TESTROOT__', str(xctestrun.parent)))
        return Path(s).resolve()
    if (resolve(target['TestBundlePath']) / 'CliqueDriver').resolve() != binary.resolve():
        raise RuntimeError('runner-testbundle-not-bound')
    if not resolve(target['TestHostPath']).exists(): raise RuntimeError('runner-testhost-missing')
    return config
