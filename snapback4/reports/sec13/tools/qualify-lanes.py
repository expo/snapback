import argparse,pathlib,tempfile,subprocess,json,hashlib,concurrent.futures
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--out',required=True);a=p.parse_args();binary=str(pathlib.Path(a.binary).resolve());out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True)
fixtures=pathlib.Path(__file__).resolve().parents[3] / 'crates/snapback4-lang/tests/security/sec13'
codes={'N_OPTIONAL_EVIDENCE','N_CHILD_EVIDENCE_PRESENCE','N_MOVABLE_TIME_ANCHOR','N_EVENT_TIME_ANCHOR'}
def safe(lane,source):
 if lane=='004':return source.replace('name: text 1..80, photo: image <=20000000 ?', 'name: text 1..80, photo: image <=20000000').replace(' { address, phone, careNeeds, price, moveDate }',' { address, phone, careNeeds, price }')
 if lane=='017':return source.replace('deposit: int 0.., safetyAgreement: image <=5000000 ?', 'deposit: int 0.., safetyAgreement: image <=5000000')
 if lane=='025':return source.replace('now <= prior.completedAt + 30d','scheduledAt <= prior.completedAt + 30d')
 if lane=='029':return source.replace('  scheduledAt: time\n','  scheduledAt: time\n  originalAt: time\n  immutable originalAt\n').replace('stops, scheduledAt }','stops, scheduledAt, originalAt: scheduledAt }').replace('m.scheduledAt + 60d','m.originalAt + 60d')
 if lane=='033':return source.replace('priceCents: int 1..100000000, detail: text 1..500 ?):','priceCents: int 1..100000000, photo: image <=10000000, detail: text 1..500 ?):').replace("  return insert jobs { customer: p.principal, address, detail, priceCents, status: 'quoted', quotedAt: now }","  j = insert jobs { customer: p.principal, address, detail, priceCents, status: 'quoted', quotedAt: now }\n  insert jobPhotos { job: j.id, photo }\n  return j")
def relevant(lane,n,d):
 if lane=='004':return d['code']=='N_MOVABLE_TIME_ANCHOR' or d['code']=='N_OPTIONAL_EVIDENCE' and n['message'].startswith('rooms.photo ')
 if lane=='017':return d['code']=='N_OPTIONAL_EVIDENCE' and n['message'].startswith('parties.safetyAgreement ')
 if lane=='025':return d['code']=='N_EVENT_TIME_ANCHOR'
 if lane=='029':return d['code']=='N_MOVABLE_TIME_ANCHOR' and 'moves.scheduledAt' in n['message']
 if lane=='033':return d['code']=='N_CHILD_EVIDENCE_PRESENCE' and n['message'].startswith('jobs:')
def run(item):
 lane,variant,source=item
 with tempfile.TemporaryDirectory(prefix='sec13-final-lane-')as tmp:
  root=pathlib.Path(tmp);(root/'snapback').mkdir();(root/'snapback/schema.q').write_text(source)
  default=subprocess.run([binary,'check'],cwd=root,text=True,capture_output=True,timeout=300)
  checked=subprocess.run([binary,'check','--json'],cwd=root,text=True,capture_output=True,timeout=300);report=json.loads(checked.stdout)
  notes=(report.get('security')or{}).get('notes',[])+report.get('notes',[])
  decisions=[]
  for d in report['securityReviews']:
   if d['code']not in codes:continue
   n=next(n for n in notes if n['code']==d['code']and f"{n['site']['file']}:{n['site']['line']}:{n['site']['col']}"==d['site'])
   if relevant(lane,n,d):decisions.append({'code':d['code'],'message':n['message'],'gated':d['gated'],'witness':d.get('witness')})
  result={'lane':lane,'variant':variant,'sourceSha256':hashlib.sha256(source.encode()).hexdigest(),'defaultExit':default.returncode,'defaultLines':len((default.stdout+default.stderr).splitlines()),'defaultText':default.stdout+default.stderr,'jsonExit':checked.returncode,'questions':decisions}
  (out/f'{lane}-{variant}.json').write_text(json.dumps(result,indent=2)+'\n');return result
items=[(q.stem,variant,q.read_text() if variant=='actual' else safe(q.stem,q.read_text()))for q in sorted(fixtures.glob('*.q'))for variant in ['actual','safe']]
with concurrent.futures.ThreadPoolExecutor(max_workers=5)as ex:results=list(ex.map(run,items))
for r in results:
 count=sum(bool(d['witness'])for d in r['questions']);print(r['lane'],r['variant'],r['defaultExit'],r['defaultLines'],count,flush=True)
 assert r['defaultExit']==0 and r['jsonExit']==0,r
 assert not any(d['gated']for d in r['questions'])
 if r['variant']=='actual':
  required=2 if r['lane']=='004'else 1
  assert count>=required,(r['lane'],r['questions'])
  if r['lane']=='033':assert any(d['witness']and d['witness']['operation']=='openJob'for d in r['questions'])
  assert all(d['code']in r['defaultText']for d in r['questions']if d['witness'])
 else:assert count==0,(r['lane'],[(d['code'],d['witness']and d['witness']['operation'])for d in r['questions']])
(out/'summary.json').write_text(json.dumps({'binarySha256':hashlib.sha256(pathlib.Path(binary).read_bytes()).hexdigest(),'actualFindingShapes':6,'safeVariants':5,'results':[{k:v for k,v in r.items()if k not in ['defaultText','questions']}for r in results]},indent=2)+'\n')
