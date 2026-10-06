"""Serial builder custody of newly created default Xcode DerivedData directories."""
from common import *

SHARED_CACHES = {'CompilationCache.noindex', 'ModuleCache.noindex',
                 'SDKStatCaches.noindex', 'SDKExplicitPrecompiledModules'}

def directory(): return Path.home() / 'Library/Developer/Xcode/DerivedData'

MANIFEST_SETTING = ['com.apple.dt.Xcode', 'IDEPackageSupportDisableManifestSandbox']

def manifest_setting():
    result = subprocess.run(['/usr/bin/defaults', 'read', *MANIFEST_SETTING], capture_output=True, text=True, timeout=10)
    if result.returncode == 1 and any(s in result.stderr for s in ['does not exist', 'Could not find key']): return None
    if result.returncode or result.stdout.strip() not in ('0', '1'):
        raise RuntimeError('unexpected-xcode-manifest-sandbox-setting')
    kind = subprocess.run(['/usr/bin/defaults', 'read-type', *MANIFEST_SETTING], capture_output=True, text=True, timeout=10)
    if kind.returncode or 'boolean' not in kind.stdout: raise RuntimeError('nonboolean-xcode-manifest-sandbox-setting')
    return result.stdout.strip() == '1'

def set_manifest_setting(value):
    argv = (['/usr/bin/defaults', 'delete', *MANIFEST_SETTING] if value is None else
            ['/usr/bin/defaults', 'write', *MANIFEST_SETTING, '-bool', 'YES' if value else 'NO'])
    subprocess.run(argv, check=True, capture_output=True, text=True, timeout=10)
    if manifest_setting() is not value: raise RuntimeError('xcode-manifest-sandbox-setting-did-not-stick')

def listing(root):
    rows = {}
    for p in sorted(root.iterdir()):
        s = p.lstat()
        rows[p.name] = {'device': s.st_dev, 'inode': s.st_ino,
                        'kind': 'directory' if stat.S_ISDIR(s.st_mode) else 'other'}
    return rows

def begin(private, logs, configure_xcode=True):
    # Caller holds authoring-or-operator.lock through confirmed child cleanup
    # and finish(). A crash leaves this reservation to block another builder.
    root = directory(); root.mkdir(parents=True, exist_ok=True)
    active = ROOT / 'runtime/derived-data-active.json'
    value = {'at': time.time(), 'root': str(root), 'private': str(private),
             'logs': str(logs), 'before': listing(root), 'configureXcode': configure_xcode}
    if configure_xcode: value['manifestSandboxBefore'] = manifest_setting()
    put(active, value)
    put(logs / 'derived-data-before.json', value)
    if configure_xcode:
        # Expo clears environment and Xcode resets script PATH, so an argv shim
        # cannot reach every nested invocation. Scope the Xcode preference to
        # this lease; the outer Seatbelt sandbox still governs all descendants.
        set_manifest_setting(True)
        put(logs / 'xcode-setting-enabled.json', {'key': MANIFEST_SETTING, 'value': True})
    return value

def finish(value):
    root = Path(value['root']); logs = Path(value['logs'])
    active = ROOT / 'runtime/derived-data-active.json'
    if read(active) != value: raise RuntimeError('derived-data-reservation-mismatch')
    if value.get('configureXcode'):
        if manifest_setting() is not True: raise RuntimeError('xcode-setting-changed-during-build')
        set_manifest_setting(value['manifestSandboxBefore'])
        put(logs / 'xcode-setting-restored.json', {'key': MANIFEST_SETTING,
            'value': value['manifestSandboxBefore'], 'restored': True})
    after = listing(root); put(logs / 'derived-data-after.json', after)
    # Do not move replacements of pre-existing directories or follow symlinks.
    for name, old in value['before'].items():
        if after.get(name) != old: raise RuntimeError('derived-data-baseline-changed:' + name)
    created = sorted(set(after) - set(value['before']))
    if any(after[n]['kind'] != 'directory' for n in created):
        raise RuntimeError('derived-data-new-nondirectory')
    target = Path(value['private']) / 'derived-data'; target.mkdir(mode=0o700)
    for name in created:
        src, dst = root / name, target / name
        if dst.exists(): raise RuntimeError('derived-data-destination-exists:' + name)
        # Atomic rename on this host; EXDEV fails closed rather than copying
        # and risking a partial shared product visible to the next builder.
        src.rename(dst)
        record(logs / 'derived-data-moves.jsonl', source=str(src), destination=str(dst), **after[name])
    remaining = listing(root)
    if remaining != value['before']: raise RuntimeError('derived-data-cleanup-incomplete')
    result = {'complete': True, 'at': time.time(), 'created': created,
              'destination': str(target), 'remaining': remaining}
    put(logs / 'derived-data-cleanup.json', result)
    active.unlink()
    return result
