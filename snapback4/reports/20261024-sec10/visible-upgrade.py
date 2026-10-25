#!/usr/bin/env python3
"""Qualify visible-minimum hardening on actual predecessor-created store bytes."""
import argparse,hashlib,json,pathlib,subprocess,tempfile,os
p=argparse.ArgumentParser();p.add_argument('--old',required=True);p.add_argument('--new',required=True);p.add_argument('--out',required=True);a=p.parse_args()
source="""use personas clerk
table docs:
  reason: text 1..30
  count: int default 0
  read <- allow
  insert <- allow
  update <- allow
  online only
mutation create(reason: text 1..30):
  return insert docs {reason}
query get(doc: docs):
  return docs[doc]
mutation touch(doc: docs):
  update docs[doc] {count:1}
mutation replace(doc: docs,reason: text 1..30):
  require viewer = 'dev:clerk' else NOT_CLERK
  update docs[doc] {reason}
"""
rows=[]
with tempfile.TemporaryDirectory(prefix='sb4-visible-upgrade-') as temporary:
 root=pathlib.Path(temporary);(root/'snapback').mkdir();(root/'snapback/schema.q').write_text(source)
 def run(binary,op,args,status=0):
  r=subprocess.run(['timeout','90s',binary,'run',op,json.dumps(args),'--as','clerk','--json'],cwd=root,capture_output=True,text=True,timeout=95,env={**os.environ,'TMPDIR':temporary})
  assert r.returncode==status,(op,r.returncode,r.stdout,r.stderr)
  value=json.loads(r.stdout);value={'result':value.get('data',value.get('result',value))};rows.append(dict(binary=hashlib.sha256(pathlib.Path(binary).read_bytes()).hexdigest(),op=op,status=status,result=value));return value
 created=run(a.old,'create',{'reason':'\u200b'});doc=created['result']['id']
 assert run(a.new,'get',{'doc':doc})['result']['reason']=='\u200b'
 run(a.new,'touch',{'doc':doc},1)
 assert run(a.new,'get',{'doc':doc})['result']['count']==0
 run(a.new,'replace',{'doc':doc,'reason':'\u2060'},1)
 run(a.new,'replace',{'doc':doc,'reason':'Actual consent'})
 assert run(a.new,'get',{'doc':doc})['result']['reason']=='Actual consent'
 run(a.new,'touch',{'doc':doc})
 assert run(a.new,'get',{'doc':doc})['result']['count']==1
pathlib.Path(a.out).write_text(json.dumps(dict(ok=True,steps=rows),indent=2)+'\n')
print('old store retained; invisible writes refused atomically; authorized repair succeeded')
