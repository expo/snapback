#!/usr/bin/env python3
"""Validate untouched original affected evidence plus the single complete client rerun, if needed."""
import hashlib,json,pathlib,re,subprocess,sys
w=pathlib.Path('/home/ccheever/sb4-pub-0441');r=pathlib.Path('/home/ccheever/sb4-pub-0451-records')
read=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
plan=read(r/'opening-affected-plan.json');head=plan['head']
p=sorted((w/'target/affected').glob(head[:12]+'-*.json'))[-1];parent=read(p)
assert parent['head']==head and parent['complete'] and parent['unchanged']
assert len(parent['results'])==len(parent['steps']) and [x['id'] for x in parent['results']]==[x['id'] for x in parent['steps']]
if parent['ok']:
 assert all(x['status']==0 for x in parent['results']) and (r/'opening-affected.exit').read_text().strip()=='0'
 kind='complete affected run'
else:
 assert (r/'opening-affected.exit').read_text().strip()=='1'
 assert [x['id'] for x in parent['results'] if x['status']!=0]==['client-tests']
 effective=read(r/'opening-effective-qualification.json');qpath=r/'opening-client-full-rerun-receipt.json';q=read(qpath)
 assert effective['schemaVersion']=='pub051.affected-requalification.v1' and effective['ok']
 assert q['schemaVersion']=='pub051.client-rerun.v1' and q['complete'] and q['ok']
 assert q['head']==effective['head']==head and q['inputDigest']==effective['inputDigest']==parent['inputDigest']
 assert q['parentReceipt']==effective['originalReceipt']==str(p)
 assert q['parentSha256']==effective['parentSha256']==sha(p)
 assert effective['rerunReceipt']==str(qpath) and effective['rerunSha256']==sha(qpath)
 assert q['before']==q['after']=={'head':head,'inputDigest':parent['inputDigest']}
 assert [x['id'] for x in q['results']]==['client-tests','client-models']
 for result in q['results']:
  step=next(x for x in parent['steps'] if x['id']==result['id'])
  assert result['status']==0 and not result.get('signal') and not result.get('error')
  assert all(result[k]==step[k] for k in ['argv','cwd','timeoutSeconds'])
  assert pathlib.Path(result['log']).is_file() and (r/('opening-client-full-rerun-'+result['id']+'.exit')).read_text().strip()=='0'
  count=len(step['argv'])-4
  assert step['argv'][1].endswith('run-client-tests.mjs') and step['argv'][3] in ['files','models']
  def summary(path):
   rows=[(int(a),int(b),int(f),json.loads(j)) for a,b,f,j in re.findall(r'^-- client files: (\d+)/(\d+); failed (\d+); tests (.+)$',path.read_text(),re.M) if int(b)==count]
   assert rows;return rows[-1]
  before=summary(r/'opening-affected.log');after=summary(pathlib.Path(result['log']))
  assert after[0]==after[1]==count and after[2]==0
  assert after[3]['fail']==0 and after[3]['cancelled']==0
  assert after[3]['pass']>=before[3]['pass'] and after[3]['skipped']<=before[3]['skipped'], 'rerun cannot gain success by skipping previous coverage'

 expected=[{'id':x['id'],'originalStatus':x['status'],'status':0,'evidence':str(qpath) if x['id']=='client-tests' else str(p)} for x in parent['results']]
 assert effective['checks']==expected
 assert (r/'opening-client-full-rerun.exit').read_text().strip()=='0'
 assert (r/'opening-live-margin-six/source.sha').read_text().strip()==head
 for i in range(1,7):assert (r/f'opening-live-margin-six/run-{i}.exit').read_text().strip()=='0'
 kind='complete affected run plus one full client check rerun after standalone-six flake classification'
print(json.dumps({'ok':True,'head':head,'kind':kind,'originalReceipt':str(p),'originalReceiptSha256':sha(p),'originalOk':parent['ok'],'steps':len(parent['steps'])},indent=2))
