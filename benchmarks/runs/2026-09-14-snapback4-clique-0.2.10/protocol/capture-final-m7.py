#!/usr/bin/env python3
"""Record completed M7 source/file identities externally; no packet writes."""
import argparse
import hashlib
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/Users/ccheever/projects/snapback-lanebriefs')
PACKET = Path('/Users/ccheever/clique-sb4-20260913-relaxed-3models')

def identity(p):
    raw = p.read_bytes()
    return {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
            'mtimeNs': p.stat().st_mtime_ns}

def main(wave):
    lane = PACKET / 'lanes' / f'{wave}-snapback4'
    root = ROOT / 'cell-custody-0.2.10' / wave
    end_path = PACKET / 'logs' / f'{wave}-snapback4.m7.end.json'
    end = json.loads(end_path.read_text())
    observer_end = json.loads((root / 'm7-observer/end.json').read_text())
    assert observer_end['reason'] == 'phase-end-present'
    out = root / 'm7-final-identities.json'
    assert not out.exists(), 'Preserve prior capture; use a new named observation'
    spec = importlib.util.spec_from_file_location('observer', ROOT / 'm7-custody-observer.py')
    observer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(observer)
    sources = {str(p.relative_to(lane)): identity(p) for p in observer.source_files(lane)}
    old = json.loads((root / 'pre-m7-source/custody.json').read_text())['files']
    changed, missing = [], []
    for name, prior in old.items():
        p = lane / name
        if not p.is_file():
            missing.append(name)
        elif identity(p)['sha256'] != prior['original']['sha256']:
            changed.append(name)
    control_path = ROOT / 'cell-custody-0.2.10/muse/installed-files-after-builder.json'
    control = json.loads(control_path.read_text())['packages']
    packages = {}
    for name, data in control.items():
        base = lane / 'node_modules' / name
        version = json.loads((base / 'package.json').read_text())['version']
        files = {}
        for rel, expected in data['files'].items():
            p = base / rel
            actual = identity(p) if p.is_file() else None
            expected_hash = expected['expectedSha256']
            exception = (wave == 'grok' and name == 'snapback4-darwin-arm64' and rel == 'snapback4')
            files[rel] = {'publishedControlSha256': expected_hash, 'actual': actual,
                          'matchesPublishedControl': actual is not None and actual['sha256'] == expected_hash}
            if exception:
                files[rel]['matchesEarlierDevelopmentResigning'] = actual is not None and actual['sha256'] == '929be28d4907839a25b88d9ec456b2a1a18c44921e8e223f86e6982c64cb8ed2'
        packages[name] = {'version': version, 'files': files,
                          'contentControlAvailable': bool(data['files'])}
    receipt = {'observedAt': datetime.now(timezone.utc).isoformat(), 'lane': wave,
               'phaseEnd': end, 'phaseEndIdentity': identity(end_path),
               'observerEnd': observer_end, 'sourceHashes': sources,
               'changedOriginalSourcePaths': changed, 'missingOriginalSourcePaths': missing,
               'newPathsOutsideOriginalManifest': sorted(set(sources) - set(old)),
               'installedPackages': packages, 'packageControlPath': str(control_path),
               'packageControlIdentity': identity(control_path),
               'capturingToolSha256': identity(Path(__file__))['sha256'],
               'limits': 'One late read-only file observation after actual phase end, not continuous identity or runtime verification. '
                         'Source scope follows the passive observer and includes evidence JSON under m7; content hashes alone do not qualify behavior. '
                         'Original-manifest deltas include only its paths; newly discovered paths are listed separately. '
                         'Expo is metadata only. Grok development re-signing is compared separately, not equated to published binary identity.'}
    out.write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'output': str(out), 'sourceFiles': len(sources), 'changedOriginal': changed,
                      'missingOriginal': missing, 'packageDifferences': {
                          n: [r for r, v in p['files'].items() if not v['matchesPublishedControl']]
                          for n, p in packages.items()}}, indent=2))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('wave', choices=['astra', 'grok', 'muse'])
    main(parser.parse_args().wave)
