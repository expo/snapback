#!/usr/bin/env python3
import json,pathlib,collections,hashlib,re,gzip
ROOT=pathlib.Path(__file__).resolve().parent
def load(name):
 path=ROOT/name
 if path.exists():return json.loads(path.read_text())
 aliases={'before/results.json':'before-results.json.gz','typed-corpus/results.json':'corpus-results.json.gz','review-cost-typed/results.json':'review-cost-results.json','matrix-typed/results.json':'matrix-results.json'}
 path=ROOT/aliases[name]
 return json.loads(gzip.decompress(path.read_bytes())) if path.suffix=='.gz' else json.loads(path.read_text())
old=[r for r in load('before/results.json') if r['variant']=='own']
corpus=load('typed-corpus/results.json');new=[r for r in corpus if r['variant']=='own' and r['lane'].startswith('w22-')]
own=[r for r in corpus if r['variant']=='own']
assert len(corpus)==800 and len(own)==400
reviews=load('review-cost-typed/results.json');assert len(reviews)==sum(bool(r['gates']) for r in own)
matrix=load('matrix-typed/results.json');assert len(matrix)==24
codes=['N_ROLE_WIDE_READ','N_BROAD_READ','N_GRANT_OUTLIVES_ROLE','N_OPTIONAL_EVIDENCE','N_INSERT_WRITE_INTENT','N_COLUMN_RESULT_EXPOSURE','N_RETAINED_ROLE_GRANT','N_OPTIONAL_UPLOAD_CREATE']
def counts(rows,code):return dict(projects=sum(code in r['codes'] for r in rows),visible=sum(code in r['visible'] for r in rows),notes=sum(n['code']==code for r in rows for n in r['notes']))
summary=dict(source='a8fb2ddf9c',visibility={c:dict(before=counts(old,c),after=counts(new,c)) for c in codes},corpus=dict(projects=len(own),variants=len(corpus),gatesByWave=dict(collections.Counter(r['lane'].split('-')[0] for r in own if r['gates'])),gatesByCode={c:sum(c in r['gates'] for r in own) for c in ['N_RETAINED_ROLE_GRANT','N_OPTIONAL_UPLOAD_CREATE']},gateProjects=sum(bool(r['gates']) for r in own),gateNotes=sum(len(r['gates']) for r in own),nonGateReds=sum(bool(r['exit']) and not r['gates'] for r in corpus),afterMechanicalDispositionReds=sum(bool(r['after']) for r in reviews),ackNoteCount=sum(r['notes'] for r in reviews)),matrix=[])
for row in matrix:
 path=ROOT/'matrix-typed'/(row['lane']+'-'+row['variant']+'.txt');s=path.read_text() if path.exists() else '\n'.join(row['summary']);m=re.search(r'security tests: (\d+) attempted, (\d+) refused, (\d+) reachable violations; (\d+) seed/synthetic',s);d=re.search(r'security directed histories: (\d+) mutation attempts; peak (\d+)',s)
 summary['matrix'].append({k:row[k] for k in ['lane','variant','sha256','checkExit','testExit','visible','gates']}|dict(attempted=int(m[1]) if m else None,reachable=int(m[3]) if m else None,synthetic=int(m[4]) if m else None,directed=int(d[1]) if d else row.get('directed'),peakWorlds=int(d[2]) if d else row.get('peakWorlds')))
summary['binaries']=load('SUMMARY.json').get('binaries',{}) | {name:hashlib.sha256((ROOT.parents[1]/'target'/name).read_bytes()).hexdigest() for name in ['sec7-baseline','sec7-typed-cli'] if (ROOT.parents[1]/'target'/name).exists()}
(ROOT/'SUMMARY.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary['corpus'],indent=2))
