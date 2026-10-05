from pathlib import Path
import json,collections,hashlib,gzip
out=Path(__file__).resolve().parent
repo=out.parents[3]
rows=[json.loads(line) for line in (out/'runs/receipts.jsonl').read_text().splitlines()]
groups=collections.defaultdict(list)
for row in rows:groups[row['file']].append(row)
assert len(groups)==17
assert len(rows)==510
for file,items in groups.items():
 assert sorted(r['run'] for r in items)==list(range(1,31)),file
 assert all(r['counts'].get('skipped',0)==0 and r['counts'].get('cancelled',0)==0 for r in items),file
for file,expected in json.loads((out/'source-sha256.json').read_text()).items():
 assert hashlib.sha256((repo/file).read_bytes()).hexdigest()==expected,file
summary={'invocations':len(rows),'passedInvocations':sum(r['passed'] for r in rows),'failedInvocations':sum(not r['passed'] for r in rows),'counts':dict(sum((collections.Counter(r['counts']) for r in rows),collections.Counter())),
 'files':{file:{'runs':len(items),'passed':sum(r['passed'] for r in items),'failedRuns':[r['run'] for r in items if not r['passed']],'counts':dict(sum((collections.Counter(r['counts']) for r in items),collections.Counter()))} for file,items in sorted(groups.items())},
 'failures':[r for r in rows if not r['passed']]}
(out/'summary.json').write_text(json.dumps(summary,indent=2))
with gzip.open(out/'receipts.jsonl.gz','wb') as dest:dest.write((out/'runs/receipts.jsonl').read_bytes())
print(json.dumps({k:v for k,v in summary.items() if k not in ['files','failures']},indent=2))
