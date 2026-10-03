# Recount retained results; run from any directory after both qualifications end.
import collections, gzip, hashlib, json, re
from pathlib import Path
out = Path(__file__).resolve().parent

def read(path):
    return path.read_text() if path.exists() else gzip.open(str(path)+'.gz', 'rt').read()

def save(name, data):
    (out / name).write_text(json.dumps(data, indent=2)+'\n')

assert (out/'stress/summary.json').exists(), 'stress has not drained'
rows = [json.loads(line) for line in read(out/'stress/runs.jsonl').splitlines()]
assert len({r['label'] for r in rows}) == len(rows), 'duplicate execution label'
summary = {}
for kind in ['worker', 'replacement', 'load']:
    subset = [r for r in rows if r['label'].startswith(kind+'-')]
    summary[kind] = dict(executions=len(subset), passed=sum(r['passed'] for r in subset),
        failures=[r for r in subset if not r['passed']],
        files=len(set(r['file'] for r in subset)),
        assertionCounts=sorted(set(r.get('counts', {}).get('tests', 0) for r in subset)),
        activeBackgroundSlots=sorted(set(r['active'] for r in subset)))
summary['runnerRefusals'] = [r for r in rows if r.get('reason') or r.get('inspectionFailure')]
summary['missingCounts'] = [r for r in rows if not r.get('counts')]
summary['unexpectedKeeperExits'] = [r for r in rows if not r.get('keeperExit', {}).get('cleanupAcknowledged')]
save('stress-stats.json', summary)
save('stress-failure-classification.json', [dict(r, classification='needs assessment') for r in rows if not r['passed']])

full = read(out/'full-suite.log')
records, counts = [], {}
for line in full.splitlines():
    match = re.fullmatch(r'# (tests|pass|fail|cancelled|skipped|todo) (\d+)', line)
    if match:
        counts[match[1]] = int(match[2])
    match = re.fullmatch(r'-- client file (ok|FAIL): (.*) \((\d+) ms\)', line)
    if match:
        records.append(dict(file=match[2], passed=match[1]=='ok', elapsed=int(match[3]), counts=counts))
        counts = {}
totals = dict(collections.Counter({key:sum(r['counts'].get(key,0) for r in records)
    for key in ['tests','pass','fail','cancelled','skipped','todo']}))
full_summary = dict(summaryLine=re.findall(r'^== \d+ failure\(s\) in \d+ s$',full,re.M)[-1],
    failedCategories=re.findall(r'^-- FAIL: (.*)$',full,re.M),
    fileResults=len(records), failedFiles=[r for r in records if not r['passed']],
    totals=totals, clientBatchSummaries=re.findall(r'^-- client files: .*$',full,re.M),
    sha256=hashlib.sha256(full.encode()).hexdigest())
save('full-suite-summary.json', full_summary)
save('full-suite-files.json', records)
save('full-suite-failure-classification.json', dict(introduced=full_summary['failedFiles'],
    baseline=[],environmental=[],runnerRefusals=[],failedCategories=full_summary['failedCategories']))
print(json.dumps({'stress':{k:{key:v for key,v in value.items() if key!='failures'} for k,value in summary.items() if isinstance(value,dict)},'suite':full_summary},indent=2))
