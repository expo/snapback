from pathlib import Path
import json,hashlib,stat,struct,time,urllib.parse
r=Path('/Users/ccheever/sb4-np/evidence/round3')
def digest(b):return hashlib.sha256(b).hexdigest()
def inventory(root):
 rows=[]
 def walk(p):
  for f in sorted(p.iterdir(),key=lambda f:f.name):
   st=f.lstat();row={'path':str(f.relative_to(root)),'mode':stat.S_IMODE(st.st_mode)}
   if f.is_symlink():row.update(type='symlink',target=str(f.readlink()));rows.append(row)
   elif f.is_dir():row.update(type='directory');rows.append(row);walk(f)
   else:b=f.read_bytes();row.update(type='file',bytes=len(b),sha256=digest(b));rows.append(row)
 walk(root);return {'files':rows,'bytes':sum(x.get('bytes',0) for x in rows),'sha256':digest(json.dumps(rows,separators=(',',':'),ensure_ascii=False).encode())}
results=[]
for command in sorted(r.glob('*-command.json')):
 c=json.loads(command.read_text());name=command.name[:-len('-command.json')];d=r/name
 if c.get('exitStatus')!=0:continue
 rec=d/('repack.json' if '--repack' in c['argv'] else 'build.json');j=json.loads(rec.read_text());app=Path(j['executedApp']['path']);inv=inventory(app);assert inv==j['executedApp']['inventory'],name
 native=[row for row in inv['files'] if row['type']=='file' and (app/row['path']).read_bytes()[:4].hex() in {'cffaedfe','feedfacf','cafebabe','bebafeca','cefaedfe'}];assert native==j['executedApp']['native'],name
 js=(app/'main.jsbundle').read_bytes();assert js[:8].hex()=='c61fbc03c103191f';assert digest(js)==j['executedApp']['javascript']['sha256'];assert struct.unpack_from('<I',js,8)[0]==98
 for phase in j['phases']:assert digest((d/phase['log']).read_bytes())==phase['sha256']
 proof=d/'proof.json';run=d/('repack-smoke-ios-run.json' if '--repack' in c['argv'] else 'smoke-ios-run.json');rr=json.loads(run.read_text());pp=json.loads(proof.read_text())
 assert digest(rec.read_bytes())==pp['preparation']['sha256']
 for key,a in rr['artifacts'].items():
  if not a:continue
  f=Path(a['path']);assert f.stat().st_size==a['bytes'] and digest(f.read_bytes())==a['sha256'],(name,key)
 receipts=[json.loads(line) for line in (d/('repack-smoke-ios-receipts.jsonl' if '--repack' in c['argv'] else 'smoke-ios-receipts.jsonl')).read_text().splitlines()]
 for segment in ['prime','offline','restart']:
  assert rr['segments'][segment]['status']=='passed'
  obs=[row['startup'] for row in receipts if row.get('startup',{}).get('segment')==segment];assert len(obs)==1
  o=obs[0];url=urllib.parse.urlparse(o['scriptURL']);assert url.scheme=='file' and not url.netloc and not url.query and not url.fragment
  assert urllib.parse.unquote(url.path)==o['selectedBundlePath']==pp['installedBundlePath']
  assert o['javascriptSha256']==digest(js) and o['proofSha256']==digest(proof.read_bytes()) and o['dev'] is False and o['release'] is True and o['hermes'] is True
  if name.startswith(('final-','qualified-','stage-','sealed-')):
   for key in ['launcherManifestPresent','updatesPresent','updatesManifestPresent']:assert o[key] is False
  sm=rr['segments'][segment]['receipt'];assert sm['generation']==sm['queryGeneration']==rr['queryGeneration'];assert sm['queryFacts']==rr['queryFacts']
  assert sm['pass'] is True
 probes=[x['np'] for x in receipts if x.get('np',{}).get('historyCount') is not None]
 assert len(probes)==3 and all(x['historyCount']==8 and x['font'] is True and x['media']['local'] is True for x in probes)
 assert all(x['marker']==('NP A' if 'a-ownbuild' in name else 'NP B') for x in probes)
 assert sum(x.get('np',{}).get('imageLoaded') is True for x in receipts)==3
 for seg in ['prime','offline','restart']:
  queries=rr['segments'][seg]['receipt']['queries']
  if seg=='offline': assert len([q for q in queries if q['classification']=='device-answerable'])==6
  else: assert len(queries)==2 and all(q['classification']=='online-only' for q in queries)
  assert all(q['state']=='ready' for q in queries if seg!='offline' or q['classification']=='device-answerable')
  if seg=='offline':
   assert all(q.get('expectation')=='online-only: unavailable offline (expected)' and q['state'] in ['loading','refused'] for q in queries if q['classification']=='online-only')
 results.append({'name':name,'cliSha256':c['cliSha256'],'buildReceiptSha256':digest(rec.read_bytes()),'proofSha256':digest(proof.read_bytes()),'appBytes':inv['bytes'],'appInventorySha256':inv['sha256'],'javascript':j['executedApp']['javascript'],'native':j['executedApp']['native'],'fingerprint':j['nativeFingerprint']['fingerprint']['hash'],'podsInputSha256':j['inputs'].get('pods',{}).get('sha256'),'podsGeneratedSha256':(j['inputs'].get('podsGenerated') or {}).get('sha256'),'preparationMs':j['durationMs'],'phases':[{k:p[k] for k in ['label','durationMs','status']} for p in j['phases']],'commandMs':c['durationMs'],'segments':{k:{key:v.get(key) for key in ['status','durationMs','error']} for k,v in rr['segments'].items()},'exitStatus':rr['exitStatus']})
byName={x['name']:x for x in results}
for b in results:
 c=json.loads((r/(b['name']+'-command.json')).read_text())
 if '--repack' not in c['argv']:continue
 basePath=Path(c['argv'][c['argv'].index('--repack')+1]);a=byName[basePath.parent.name]
 assert a['native']==b['native'] and a['fingerprint']==b['fingerprint'] and a['podsInputSha256']==b['podsInputSha256'] and a['podsGeneratedSha256']==b['podsGeneratedSha256'];assert a['javascript']['sha256']!=b['javascript']['sha256'];assert a['appInventorySha256']!=b['appInventorySha256']
 if b['name'].startswith('sealed-'):
  aj=json.loads(basePath.read_text());bj=json.loads((r/b['name']/'repack.json').read_text())
  assert aj['inputs']==bj['inputs']==bj['preparedInputs']
  assert aj['sourceInputs']==bj['sourceInputs']
  assert aj['nativeClosure']==bj['nativeClosure']
for name in ['sealed-a-ownbuild-1','sealed-b-warm-ownbuild-1']:
 j=json.loads((r/name/'build.json').read_text())
 for dep in j['nativeClosure']['compiler']['records']:
  assert digest((r/name/'native-dependencies'/dep['path']).read_bytes())==dep['sha256']
(r/'independent-verification.json').write_text(json.dumps({'checkedAt':int(time.time()*1000),'implementation':'independent Python hashlib/lstat; all app entries, HBC, phase logs, run artifacts, selected URL/path, runtime flags and generation/facts binding','runs':results,'fullSmokePass':all(x['exitStatus']==0 for x in results)},indent=2)+'\n')
print([(x['name'],x['commandMs']) for x in results])
