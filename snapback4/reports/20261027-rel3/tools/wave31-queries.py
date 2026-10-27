#!/usr/bin/env python3
"""Copied-store frozen result proof. No credentials or business values are emitted."""
import argparse,ast,hashlib,json,shutil,sqlite3,subprocess,tempfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--query',required=True);p.add_argument('--out',required=True);p.add_argument('--root',default=str(Path.home()/'sb4-loop'));p.add_argument('--tmp',default='/tmp/rel3-replay');a=p.parse_args()
binary=str(Path(a.binary).resolve());query=str(Path(a.query).resolve())
harness=Path(__file__).resolve().parents[3]/'reports/integration27/tools/replay-security.py'
syntax=ast.parse(harness.read_text());namespace={}
nodes=[n for n in syntax.body if isinstance(n,(ast.Import,ast.ImportFrom)) or isinstance(n,ast.FunctionDef)and n.name=='copy']
exec(compile(ast.Module(body=nodes,type_ignores=[]),str(harness),'exec'),namespace)
cases={
 '003':dict(parent='boxes',child='photoSets',owner='owner',detail='boxDetail',childList='photoSetsForBox',arg='box',cursor=True,fields={'casePhoto':'casePhoto','combPhoto':'combPhoto','pinsPhoto':'pinsPhoto'}),
 '005':dict(parent='commissions',child='drawingSubmissions',owner='client',detail='commissionDetail',childList='submissions',arg='commission',cursor=True,fields={'drawing':'scan'}),
 '023':dict(parent='jobs',child='photoSets',owner='owner',detail='jobDetail',childList='photoSetsFor',arg='job',cursor=False,fields={'seamPhoto':'seamPhoto','hangerPhoto':'hangerPhoto','downspoutPhoto':'downspoutPhoto'})}
def digest(value):return hashlib.sha256(json.dumps(value,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
def cli(cwd,*args):
 r=subprocess.run([binary,*args,'--json'],cwd=cwd,capture_output=True,text=True,timeout=180)
 if r.returncode:raise RuntimeError('CLI refusal at '+args[0]+'; private diagnostics suppressed')
 return json.loads(r.stdout)
def probes(cwd,requests):
 path=cwd/'query-input.json';path.write_text(json.dumps(requests));path.chmod(0o600)
 r=subprocess.run([query,str(cwd/'deploy'),str(path)],capture_output=True,text=True,timeout=90)
 if r.returncode:raise RuntimeError('private query probe refused; diagnostics suppressed')
 return {r['label']:r for r in json.loads(r.stdout)['results']}
results=[]
for lane,case in cases.items():
 source=next((Path(a.root)/'wave31/apps').glob(lane+'-snapback-*'))
 with tempfile.TemporaryDirectory(prefix='rel3-query-'+lane+'-',dir=a.tmp)as temporary:
  cwd=Path(temporary);namespace['copy'](source,cwd)
  state=cli(cwd,'releases','deploy');cli(cwd,'rollback','deploy','--to',str(state['latest']),'--exact');cli(cwd,'deploy','deploy')
  db=sqlite3.connect(cwd/'deploy/store.sqlite');catalog=dict(db.execute('SELECT name,num FROM _catalog'));pt,ct=catalog[case['parent']],catalog[case['child']]
  parents={rid:json.loads(data)['Row']for rid,data in db.execute('SELECT id,data FROM r WHERE t=?',(pt,))}
  receipts=dict(db.execute('SELECT parent_id,child_id FROM _extraction_rows r WHERE parent_t=? AND child_t=? AND EXISTS(SELECT 1 FROM _extraction_active a WHERE a.child_t=r.child_t AND a.definition=r.definition)',(pt,ct)));db.close()
  requests=[];expected={}
  for parent,child in receipts.items():
   row=parents.get(parent);owner=(row or{}).get(case['owner'],{}).get('Id')
   if not owner:continue
   tag=digest(parent);detail={case['arg']:parent};child_args=dict(detail)
   if case['cursor']:child_args['c']=None
   requests.extend([dict(label='parent-'+tag,operation=case['detail'],viewer=owner,args=detail,fields=list(case['fields'])),dict(label='child-'+tag,operation=case['childList'],viewer=owner,args=child_args,fields=list(case['fields'].values()))]);expected[tag]=digest(child)
  assert expected,(lane,'no receipt-owned parent probes')
  before=probes(cwd,requests);cycles=[]
  for cycle in range(2):
   preview=cli(cwd,'rollback','deploy','--to','1','--check');assert preview['visibility']['hiddenRows']==0
   cli(cwd,'rollback','deploy','--to','1');after=probes(cwd,requests);verified=0
   for tag,child in expected.items():
    parent=after['parent-'+tag];children=before['child-'+tag]
    assert parent['code']is None and children['code']is None,(lane,'query refusal')
    assert len(parent['rows'])==1,(lane,'parent missing')
    image=next((row for row in children['rows']if row['idSha256']==child),None);assert image,(lane,'receipt child absent from authorized query')
    for old,new in case['fields'].items():
     old_field=parent['rows'][0]['fields'][old];new_field=image['fields'][new]
     assert old_field.get('present')and old_field.get('sha256')==new_field.get('sha256'),(lane,'frozen payload mismatch',old)
     verified+=1
   cycles.append(dict(cycle=cycle+1,parents=len(expected),verifiedPayloads=verified,hiddenV1Rows=0))
   cli(cwd,'rollback','deploy','--to','latest')
  results.append(dict(lane=lane,cycles=cycles));Path(a.out).write_text(json.dumps(dict(results=results),indent=2));print(lane,'PASS',len(expected),'receipt-owned parents; both cycles',flush=True)
