#!/usr/bin/env python3
"""Verify frozen source, symmetric aids, cold lanes and optional launch readiness."""
import argparse, ast, json, os
from common import *
from render import rendered

def verify(cold=False, ready=False):
    for line in (ROOT / 'PACKET.sha256').read_text().splitlines():
        digest, name = line.split('  ', 1)
        p = ROOT / name
        if p.is_symlink() or sha(p) != digest: raise RuntimeError('packet-drift:' + name)
        if p.stat().st_mode & 0o222: raise RuntimeError('writable-frozen-input:' + name)
    revision = ROOT / 'metadata/revision-2.json'
    if revision.exists() and sha(ROOT / 'PACKET.v1.sha256') != read(revision)['originalPacketSha256']:
        raise RuntimeError('original-packet-seal-drift')
    for n in (3, 4, 5, 6, 7, 8, 9, 10, 11):
        revision = ROOT / ('metadata/revision-%d.json' % n)
        if not revision.exists(): continue
        r = read(revision)
        if (sha(ROOT / 'PACKET.v1.sha256') != r['originalPacketSha256'] or
            sha(ROOT / ('PACKET.v%d.sha256' % (n - 1))) != r['previousPacketSha256'] or
            sha(ROOT / ('metadata/harness-v%d-v%d.diff' % (n - 1, n))) != r['harnessDiffSha256']):
            raise RuntimeError('revision-%d-history-binding-drift' % n)
    manifest = read(NATIVE / 'instrument.manifest.json'); q = read(NATIVE / 'QUALIFIED.json')
    if sha(NATIVE / 'INSTRUMENT.sha256') != q['instrument']['inventorySha256']:
        raise RuntimeError('qualified-inventory-mismatch')
    if (NATIVE / 'INSTRUMENT_COMMIT').read_text().strip() != q['instrument']['commit']:
        raise RuntimeError('qualified-commit-mismatch')
    for name, digest in manifest['files'].items():
        if sha(NATIVE / name) != digest: raise RuntimeError('native-source-drift:' + name)
    if q['driverSourceSha256'] != sha(NATIVE / 'driver/run.py'): raise RuntimeError('driver-source-mismatch')
    for part in ['helper', 'ui', 'schemas']:
        for p in (NATIVE / part).rglob('*'):
            if p.is_file() and sha(p) != sha(ROOT / 'inputs/builder/native' / p.relative_to(NATIVE)):
                raise RuntimeError('builder-aid-drift:' + str(p))
    for name in ['README.md', 'scene-plugin.cjs', 'simulator.entitlements', 'configure-signing.rb']:
        if sha(NATIVE / 'runtime-baseline' / name) != sha(ROOT / 'inputs/builder/native/runtime-baseline' / name):
            raise RuntimeError('builder-runtime-aid-drift:' + name)
    if any('reference' in p.parts for p in (ROOT / 'inputs/builder').rglob('*')):
        raise RuntimeError('reference-app-exposed')
    for b in BACKENDS:
        lane = ROOT / 'lanes' / b
        if (ROOT / 'prompts' / (b + '.md')).read_text() != rendered(b): raise RuntimeError('prompt-drift:' + b)
        if (lane / 'instrument').resolve() != (ROOT / 'inputs/builder').resolve(): raise RuntimeError('aid-link:' + b)
        if cold and sorted(p.name for p in lane.iterdir()) != ['instrument']: raise RuntimeError('lane-not-cold:' + b)
    for p in (ROOT / 'scripts').glob('*.py'): ast.parse(p.read_text())
    caps = read(ROOT / 'metadata/caps.json')
    if caps.get('cacheReadCapped') is not False or caps.get('cacheWriteCapped') is not False:
        raise RuntimeError('non-cached-pilot-cap-disclosure-required')
    if ready:
        from runtime_proof import verify_runtime_proof
        verify_runtime_proof()
        if (ROOT / 'metadata/revision-5.json').exists():
            from operator_inputs import sealed_environment
            sealed_environment()
        if (ROOT / 'runtime/derived-data-active.json').exists(): raise RuntimeError('derived-data-cleanup-pending')
        host_check(); runner_config()
        if not Path('/usr/bin/sandbox-exec').is_file(): raise RuntimeError('builder-filesystem-isolation-unavailable')
        if read(ROOT / 'metadata/convex-preflight.json')['pass'] is not True:
            raise RuntimeError('Convex-native-unmeasured-by-setup: owner ruling required')
        if sha(ROOT / 'inputs/convex/convex-local-backend') != read(ROOT / 'metadata/convex-preflight.json')['backendSha256']:
            raise RuntimeError('convex-binary-drift')
        if not (ROOT / 'runtime/venv/bin/python').exists(): raise RuntimeError('python-venv-missing')
        dependencies = subprocess.run([str(ROOT / 'runtime/venv/bin/python'), '-c',
            "import cv2,json,jsonschema,numpy,PIL;print(json.dumps([cv2.__version__,jsonschema.__version__,numpy.__version__,PIL.__version__]))"],
            capture_output=True, text=True, timeout=30)
        if dependencies.returncode or json.loads(dependencies.stdout) != ['4.12.0', '4.25.1', '2.0.2', '11.3.0']:
            raise RuntimeError('python-runtime-drift')
        browser = read(ROOT / 'metadata/browser.json'); executable = Path(browser['executable'])
        if (browser.get('package') != 'playwright' or browser.get('version') != '1.62.1' or
            not executable.is_file() or sha(executable) != browser.get('sha256')):
            raise RuntimeError('browser-runtime-drift')
        from operator_inputs import sealed_environment
        sealed_environment()
    return {'valid': True, 'cold': cold, 'launchReadinessChecked': ready, 'scoredUse': False,
            'sourceCommit': q['instrument']['commit'], 'inventory': manifest['inventorySha256']}

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--cold', action='store_true'); p.add_argument('--ready', action='store_true')
    a = p.parse_args(); print(json.dumps(verify(a.cold, a.ready)))
