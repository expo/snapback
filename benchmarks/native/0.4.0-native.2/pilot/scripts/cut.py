#!/usr/bin/env python3
"""Cut immutable component bytes from Git; no model, backend or build invocation."""
import argparse, hashlib, json, shutil, subprocess, tempfile
from pathlib import Path

def archive(repo, commit, paths, target):
    p = subprocess.Popen(['git', '-C', str(repo), 'archive', commit, *paths], stdout=subprocess.PIPE)
    result = subprocess.run(['tar', 'xf', '-', '-C', str(target)], stdin=p.stdout)
    p.stdout.close()
    if p.wait() or result.returncode: raise RuntimeError('git-archive-failed')

def main():
    p = argparse.ArgumentParser(); p.add_argument('--repo', type=Path, required=True); p.add_argument('--out', type=Path, required=True)
    a = p.parse_args(); repo = a.repo.resolve(); source = repo / 'benchmarks/native/0.4.0-native.2'
    qualified = json.loads((source / 'QUALIFIED.json').read_text()); commit = qualified['instrument']['commit']
    a.out.mkdir(); native = a.out / 'native-0.4.0-native.2'; web = a.out / 'web-0.3.8-m8'
    with tempfile.TemporaryDirectory(prefix='p2a-source-') as temp:
        stage = Path(temp)
        archive(repo, commit, ['benchmarks/native/0.4.0-native.2'], stage)
        shutil.copytree(stage / 'benchmarks/native/0.4.0-native.2', native)
    # QUALIFIED is intentionally a post-build record outside its own inventory.
    shutil.copyfile(source / 'QUALIFIED.json', native / 'QUALIFIED.json')
    (native / 'INSTRUMENT_COMMIT').write_text(commit + '\n')
    manifest = json.loads((native / 'instrument.manifest.json').read_text())
    for name, digest in manifest['files'].items():
        if hashlib.sha256((native / name).read_bytes()).hexdigest() != digest: raise RuntimeError('source-drift:' + name)
    if hashlib.sha256((native / 'INSTRUMENT.sha256').read_bytes()).hexdigest() != qualified['instrument']['inventorySha256']:
        raise RuntimeError('qualification-inventory-drift')
    inherited = manifest['inherited']
    paths = list(dict.fromkeys(['benchmarks/instrument.manifest.json'] +
                 ['benchmarks/' + v['path'] for v in inherited['manifest']['artifacts'].values()]))
    with tempfile.TemporaryDirectory(prefix='p2a-web-') as temp:
        archive(repo, inherited['sourceCommit'], paths, Path(temp))
        shutil.copytree(Path(temp) / 'benchmarks', web)
    if hashlib.sha256((web / 'instrument.manifest.json').read_bytes()).hexdigest() != inherited['manifestSha256']:
        raise RuntimeError('inherited-manifest-drift')
    record = {'sourceCommit': commit, 'qualificationRecordCommit': subprocess.check_output(
        ['git', '-C', str(repo), 'log', '-1', '--format=%H', '--', str(source / 'QUALIFIED.json')], text=True).strip(),
        'qualified': qualified, 'manifestSha256': hashlib.sha256((native / 'instrument.manifest.json').read_bytes()).hexdigest(),
        'inheritedWebCommit': inherited['sourceCommit'], 'inheritedWebManifestSha256': inherited['manifestSha256'],
        'scoredUse': False}
    (a.out / 'SOURCE.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps(record))

if __name__ == '__main__': main()
