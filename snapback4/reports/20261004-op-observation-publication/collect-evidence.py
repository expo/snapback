#!/usr/bin/env python3
"""Collect compact OP qualification evidence; raw traces remain under target/op."""
from pathlib import Path
import csv, hashlib, json, math, re, shutil, subprocess, time

root = Path(__file__).resolve().parents[2]
out = Path(__file__).resolve().parent
raw = root / 'target/op'
labels = ['before', 'after', 'final', 'repeat-final', 'repeat-before',
          'steady-final', 'steady-before', 'final3', 'paired-before', 'steady-final3', 'steady-before-repeat',
          'final4', 'steady-final4', 'paired-final4-before', 'paired-final4-after']
def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()
def stats(values):
    values = sorted(values)
    return dict(n=len(values), p50=values[math.ceil(len(values)*.5)-1],
                p95=values[math.ceil(len(values)*.95)-1], max=values[-1])
def counts(path):
    result = {name: int(value) for name, value in re.findall(r'^(?:#|ℹ) (tests|pass|fail|cancelled|skipped|todo) (\d+)$', path.read_text(), re.M)}
    assert 'tests' in result, path
    return result

record = dict(baseline='ed327e5dc715bca1c3df098b794219c1e07ff028',
              collected=time.time(), files={}, runs={}, tests={}, cpus={}, artifacts={})
for rel in ['packages/snapback4/src/local.ts', 'packages/snapback4/src/local-query.ts',
            'packages/snapback4/src/local-reads.ts', 'packages/snapback4/test/observation-publication.test.mjs',
            'packages/snapback4/test/observation-publication-live.test.mjs',
            'packages/snapback4/test/value-deadline-types.test.mjs']:
    record['files'][rel] = digest(root/rel)
for path in sorted(raw.glob('sdk-*')):
    if path.is_dir():
        manifest = {str(p.relative_to(path)): digest(p) for p in sorted(path.rglob('*')) if p.is_file()}
        record['artifacts'][str(path.relative_to(root))] = {
            'file_count': len(manifest),
            'manifest_sha256': hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
            'modules': {k: v for k, v in manifest.items() if k in ['package.json', 'dist/local.js',
                'dist/local-query.js', 'dist/local-reads.js', 'dist/wasm/snapback4_device_bg.wasm']}}
for rel in ['target/lu-op', 'packages/snapback4/src/wasm/snapback4_device_bg.wasm']:
    path=root/rel
    if path.exists(): record['files'][rel]=digest(path)
for label in labels:
    if not (raw/f'{label}.summary.json').exists(): continue
    name = {'after': 'initial', 'final': 'disjoint', 'final3': 'version-unchecked', 'final4': 'final',
            'steady-final': 'disjoint-steady', 'steady-final3': 'version-unchecked-steady', 'steady-final4': 'steady-final',
            'repeat-final': 'disjoint-heavy'}.get(label, label)
    for suffix in ['summary.json','stamps.csv']:
        shutil.copy2(raw/f'{label}.{suffix}',out/f'{name}.{suffix}')
    guards=raw/f'{label}.json.guards.json'
    if guards.exists(): shutil.copy2(guards,out/f'{name}.guards.json')
    summary=json.loads((raw/f'{label}.summary.json').read_text())
    assert not summary['errors'], (label,summary['errors'])
    rows=list(csv.DictReader((raw/f'{label}.stamps.csv').open()))
    if label in ['before','final','final3','final4']:
        with (out/f'{name}.idle-repost.csv').open('w') as f:
            writer=csv.DictWriter(f,fieldnames=list(rows[0]),lineterminator='\n');writer.writeheader()
            writer.writerows(row for row in rows if row['burners']=='0' and row['shape']=='repost')
    grouped={}
    for row in rows:
        key=f"{row['burners']}:{row['shape']}"
        grouped.setdefault(key,{}).setdefault(row['run'],[]).append(float(row['render'])-float(row['commit']))
    validation={}
    for key,runs in grouped.items():
        assert len(runs)==30 and all(len(v)==2 for v in runs.values()),(label,key)
        measured=stats([max(v) for v in runs.values()])
        expected=summary['groups'][key]['slowestRemoteRender']
        assert all(abs(measured[k]-expected[k])<.002 for k in ['p50','p95','max'])
        validation[key]=measured
    record['runs'][label]={'csv_recomputed':validation,'rows':len(rows),'errors':summary['errors']}
    for suffix in ['json','json.jsonl','log','summary.json','stamps.csv']:
        p=raw/f'{label}.{suffix}'
        record['files'][str(p.relative_to(root))]={'bytes':p.stat().st_size,'sha256':digest(p)}
    for suffix in ['run.json','affinity.json']:
        p=raw/f'{label}-{suffix}'
        if p.exists(): record['runs'][label][suffix]=json.loads(p.read_text())
for path in sorted(raw.glob('*affinity.json')):
    record['cpus'][path.name]=json.loads(path.read_text())
for path in sorted(raw.glob('cpu-*.json')):
    record['cpus'][path.name]=json.loads(path.read_text())
record['cpus']['stress-cohorts.json']=json.loads((raw/'stress-cohorts.json').read_text())
for name in ['affected-final4','progress-negative','disjoint-negative','external-negative','watch-negative','callback-final4','value-deadline-final4']:
    path=raw/f'{name}.log'
    record['tests'][name]={**counts(path),'sha256':digest(path)}
stress=json.loads((raw/'stress/results.json').read_text()) if (raw/'stress/results.json').exists() else {'runs': []}
for run in stress['runs']:
    path=raw/'stress'/f"{run['run']:02}.log"
    run.update(counts(path));run['sha256']=digest(path)
record['tests']['stress']=stress
path=raw/'stress-cleanup.json'
if path.exists(): record['tests']['stress_cleanup']=json.loads(path.read_text())
path=raw/'full-suite-result.json'
if path.exists(): record['tests']['full_suite']=json.loads(path.read_text())
path=raw/'initial-full-suite-result.json'
if path.exists(): record['tests']['initial_full_suite']=json.loads(path.read_text())
record['measured_qualified_sdk']=json.loads((raw/'measured-qualified-sdk.json').read_text())
for name in ['full-suite.log','wasm-build.log','wasm-final.log','typecheck-final.log','ref-check.log',
             'initial-full-suite.log','requalify-final4-driver.log',
             'ordinary-paired.json','ordinary-paired-reverse.json','ordinary-paired.log','ordinary-paired-reverse.log']:
    path=raw/name
    if path.exists(): record['files'][str(path.relative_to(root))]={'bytes':path.stat().st_size,'sha256':digest(path)}
record['disk_bytes_at_collection']=int(subprocess.check_output(['du','-sb',str(root.parent)]).split()[0])
for name in ['disk-samples.jsonl','initial-disk-samples.jsonl']:
    path=raw/name
    if path.exists():
        samples=[json.loads(line) for line in path.read_text().splitlines()]
        record[name]={'samples':len(samples),'peak_bytes':max(r['bytes'] for r in samples),'sha256':digest(path)}
(out/'evidence.json').write_text(json.dumps(record,indent=2)+'\n')
assert (out/'evidence.json').stat().st_size<=256*1024
qualification={}
for name in ['initial-full-suite','full-suite']:
    path=raw/f'{name}.log'
    if path.exists():
        qualification[name]=[line for line in path.read_text().splitlines()
            if line.startswith(('==','-- ok:','-- FAIL:','-- client files:','-- rust target:','test result:'))]
for name,lines in qualification.items():
    path=out/('initial-qualification.json' if name.startswith('initial-') else 'qualification.json')
    path.write_text(json.dumps({name:lines},indent=2)+'\n')
    assert path.stat().st_size<=256*1024
print('Wrote evidence.json; final qualification requires 30 stress runs and full-suite exit 0.')
