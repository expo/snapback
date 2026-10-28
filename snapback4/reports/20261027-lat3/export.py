"""Retain numerical evidence and hashes; private app credentials/logs stay in /tmp."""
import argparse, hashlib, json, pathlib, runpy, sys
sys.dont_write_bytecode = True
from replay import messages, SCRATCH, ROOT, HERE, PACK

ap = argparse.ArgumentParser()
ap.add_argument('--out', type=pathlib.Path, required=True)
a = ap.parse_args()
a.out.mkdir(parents=True, exist_ok=True)
original_argv=sys.argv
sys.argv=['summarize.py','--out',str(SCRATCH/'final-summary.json')]
comparison=runpy.run_path(str(HERE/'summarize.py'))
sys.argv=original_argv
normalize=comparison['failure_messages']
summary = json.loads((SCRATCH/'final-summary.json').read_text())
if summary['setupErrors'] or summary['exitDifferences'] or summary['clientCallDifferences'] or summary['missingClientCallVectors'] or summary['messageDifferenceCount']:
    raise SystemExit('Resolve/classify identity differences before exporting a green receipt')
rows = {}; all_attempts = []
for p in sorted(SCRATCH.glob('corpus-[0-9].jsonl')):
    for line in p.read_text().splitlines():
        r = json.loads(line)
        if 'script' not in r:
            continue
        all_attempts.append(r)
        key = (r['wave'], r['lane'], r['script'])
        if key not in rows or r.get('measurementRevision', 1) > rows[key].get('measurementRevision', 1):
            rows[key] = r
expected = []
for wave in range(30, 35):
    for p in sorted(pathlib.Path(f'/home/ccheever/sb4-loop/wave{wave}/apps').glob('*-snapback-*/package.json')):
        scripts = json.loads(p.read_text()).get('scripts', {})
        for script in ['acceptance', 'frontend:proof', 'day2:proof']:
            if script in scripts:
                expected.append((wave, p.parent.name, script))
        if 'probe:serve' in scripts and 'client:calls' in scripts:
            expected.append((wave, p.parent.name, 'probe:serve/client:calls'))
if set(expected) != set(rows):
    raise SystemExit(f'Incomplete census: missing={len(set(expected)-set(rows))}, extra={len(set(rows)-set(expected))}')
corrected_cases={(32,'012'):2,(33,'009'):2,(33,'012'):2,(33,'033'):2,(33,'035'):2,(34,'028'):2,(34,'021'):3,(34,'038'):3}
final_input_cases={tuple(x) for x in json.loads((HERE/'final-input-replay-cases.json').read_text())}
for (wave,lane,script),r in rows.items():
    required=2 if wave==31 and lane.startswith('025-') and script=='day2:proof' else corrected_cases.get((wave,lane[:3]),1)
    if (wave,lane)in final_input_cases:required=4
    if r.get('measurementRevision',1)<required:
        raise SystemExit(f'Corrected paired revision still pending: {wave}/{lane}/{script}')
keys = ['code', 'seconds', 'load', 'readySeconds', 'callsSeconds', 'callsCode',
        'clientInputDigest', 'clientOutputDigest', 'nativeTraceEnabled', 'nativePhaseSeconds',
        'preflightSeconds', 'withoutPreflightSeconds', 'readyPreflightSeconds',
        'readyWithoutPreflightSeconds', 'callsWithoutPreflightSeconds', 'suppliedTmpdir', 'suppliedPortRange']
safe = []
mutated = []; trace_errors = []
for key, r in sorted(rows.items()):
    x = {k:r[k] for k in ['wave', 'lane', 'script', 'measurementRevision'] if k in r}
    for variant in ['before', 'after']:
        result = r[variant]
        x[variant] = {k:result[k] for k in keys if k in result}
        name = r['script'].replace(':', '-').replace('/', '-')
        path = SCRATCH/'corpus-logs'/f"w{r['wave']}-{r['lane']}"/f'{name}-{variant}.log'
        extracted=messages(path)
        encoded = json.dumps(extracted, separators=(',', ':')).encode()
        x[variant]['extractedMessageSha256'] = hashlib.sha256(encoded).hexdigest()
        x[variant]['normalizedMessageSha256'] = hashlib.sha256(json.dumps(normalize(extracted),separators=(',',':')).encode()).hexdigest()
        if result.get('clientInputDigest') != result.get('clientOutputDigest'):
            mutated.append([*key, variant])
        if result.get('nativeTraceError'):
            trace_errors.append([*key, variant])
    if x['before']['normalizedMessageSha256']!=x['after']['normalizedMessageSha256']:
        raise SystemExit(f'Failure messages changed during export: {key}')
    safe.append(x)
if mutated or trace_errors:
    raise SystemExit(f'Input mutation/trace parse errors: {mutated}, {trace_errors}')
summary['coverage'] = {'expectedPairs':len(expected), 'complete':True,
                       'installedClientMutations':0, 'nativeTraceParseErrors':0,
                       'pairsWithClientDigests':sum(all('clientInputDigest' in r[v] for v in ['before','after']) for r in rows.values()),
                       'pairsWithNativeTraces':sum(all(r[v].get('nativeTraceEnabled') for v in ['before','after']) for r in rows.values()),
                       'qualification':False}
artifacts = []
for path in [*sorted(PACK.glob('*.tgz')), *sorted((SCRATCH/'packs').glob('*.tgz'))]:
    artifacts.append({'role':'baseline' if path.parent == PACK else 'consumer-candidate',
                      'name':path.name, 'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
summary['artifacts'] = artifacts
summary['runtimeCommit'] = 'eb80c8c7b3'
summary['measurementNotes'] = [
    'Same retained production native binary on both sides; candidate overlays final built client JS.',
    'No original lane store opened; pairs use independent copies and alternate order.',
    'Only matched successful pairs enter timing distributions; inherited failures remain listed.',
    'Residuals subtract enclosing check/deploy security preflight, not exact witness CPU.',
    'No capability/publication qualification is claimed by this affected-scope receipt.',
]
(a.out/'measurements.json').write_text(json.dumps(safe, indent=2)+'\n')
(a.out/'summary.json').write_text(json.dumps(summary, indent=2)+'\n')
excluded = []
for r in all_attempts:
    key = (r['wave'], r['lane'], r['script'])
    if r.get('measurementRevision', 1) < rows[key].get('measurementRevision', 1):
        excluded.append((r, 'explicit original-range/TMPDIR correction or documented whole-lane diagnostic replay; selected by revision, never speed'))
for p in sorted(SCRATCH.glob('corpus-*.superseded.jsonl')):
    excluded.extend((json.loads(line), 'incomplete-lane restart or empty artifact-directory copy precondition repair') for line in p.read_text().splitlines())
retained = []
for r, reason in excluded:
    if 'script' not in r:continue
    x = {k:r[k] for k in ['wave','lane','script','measurementRevision'] if k in r};x['reason']=reason
    for variant in ['before','after']:
        if variant not in r:continue
        value=r[variant];x[variant]={k:value[k] for k in ['code','seconds','clientInputDigest'] if k in value}
        x[variant]['originalExtractedMessageSha256']=hashlib.sha256(json.dumps(value.get('messages',[]),separators=(',',':')).encode()).hexdigest()
    retained.append(x)
(a.out/'superseded-attempts.json').write_text(json.dumps(retained,indent=2)+'\n')
print(f'Exported {len(safe)} paired commands without raw credentials or app logs')
