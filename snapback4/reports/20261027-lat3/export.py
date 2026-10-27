"""Retain numerical evidence and hashes; private app credentials/logs stay in /tmp."""
import argparse, hashlib, json, pathlib, subprocess, sys
sys.dont_write_bytecode = True
from replay import messages, SCRATCH, ROOT, HERE, PACK

ap = argparse.ArgumentParser()
ap.add_argument('--out', type=pathlib.Path, required=True)
a = ap.parse_args()
a.out.mkdir(parents=True, exist_ok=True)
subprocess.run([sys.executable, str(HERE/'summarize.py'), '--out', str(SCRATCH/'final-summary.json')], check=True)
summary = json.loads((SCRATCH/'final-summary.json').read_text())
if summary['setupErrors'] or summary['exitDifferences'] or summary['clientCallDifferences'] or summary['messageDifferenceCount']:
    raise SystemExit('Resolve/classify identity differences before exporting a green receipt')
rows = {}
for p in sorted(SCRATCH.glob('corpus-[0-9].jsonl')):
    for line in p.read_text().splitlines():
        r = json.loads(line)
        if 'script' not in r:
            continue
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
keys = ['code', 'seconds', 'load', 'readySeconds', 'callsSeconds', 'callsCode',
        'clientInputDigest', 'clientOutputDigest', 'nativeTraceEnabled', 'nativePhaseSeconds',
        'preflightSeconds', 'withoutPreflightSeconds', 'readyPreflightSeconds',
        'readyWithoutPreflightSeconds', 'callsWithoutPreflightSeconds', 'suppliedTmpdir']
safe = []
mutated = []; trace_errors = []
for key, r in sorted(rows.items()):
    x = {k:r[k] for k in ['wave', 'lane', 'script', 'measurementRevision'] if k in r}
    for variant in ['before', 'after']:
        result = r[variant]
        x[variant] = {k:result[k] for k in keys if k in result}
        name = r['script'].replace(':', '-').replace('/', '-')
        path = SCRATCH/'corpus-logs'/f"w{r['wave']}-{r['lane']}"/f'{name}-{variant}.log'
        encoded = json.dumps(messages(path), separators=(',', ':')).encode()
        x[variant]['extractedMessageSha256'] = hashlib.sha256(encoded).hexdigest()
        if result.get('clientInputDigest') != result.get('clientOutputDigest'):
            mutated.append([*key, variant])
        if result.get('nativeTraceError'):
            trace_errors.append([*key, variant])
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
print(f'Exported {len(safe)} paired commands without raw credentials or app logs')
