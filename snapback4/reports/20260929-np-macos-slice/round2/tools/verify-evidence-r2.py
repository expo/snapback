from pathlib import Path
import json,hashlib,stat,struct,time,urllib.parse
r=Path('/Users/ccheever/sb4-np/evidence/round2')
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
  if name.startswith(('final-','qualified-','sealed-','timed-')):
   for key in ['launcherManifestPresent','updatesPresent','updatesManifestPresent']:assert o[key] is False
  sm=rr['segments'][segment]['receipt'];assert sm['generation']==sm['queryGeneration']==rr['queryGeneration'];assert sm['queryFacts']==rr['queryFacts']
  assert sm['pass'] is True
 results.append({'name':name,'cliSha256':c['cliSha256'],'buildReceiptSha256':digest(rec.read_bytes()),'proofSha256':digest(proof.read_bytes()),'appBytes':inv['bytes'],'appInventorySha256':inv['sha256'],'javascript':j['executedApp']['javascript'],'native':j['executedApp']['native'],'fingerprint':j['nativeFingerprint']['fingerprint']['hash'],'podsInputSha256':j['inputs'].get('pods',{}).get('sha256'),'podsGeneratedSha256':(j['inputs'].get('podsGenerated') or {}).get('sha256'),'preparationMs':j['durationMs'],'phases':[{k:p[k] for k in ['label','durationMs','status']} for p in j['phases']],'commandMs':c['durationMs'],'segments':{k:{key:v.get(key) for key in ['status','durationMs','error']} for k,v in rr['segments'].items()},'exitStatus':rr['exitStatus']})
byName={x['name']:x for x in results}
for b in results:
 if 'b-repack' not in b['name']:continue
 a=byName['sealed-a-ownbuild-2' if b['name'].startswith(('sealed-','timed-')) else 'qualified-a-ownbuild-1' if b['name'].startswith('qualified-') else 'a-ownbuild-2' if b['name'].startswith('b-repack') else 'final-a-ownbuild-1']
 assert a['native']==b['native'] and a['fingerprint']==b['fingerprint'] and a['podsInputSha256']==b['podsInputSha256'] and a['podsGeneratedSha256']==b['podsGeneratedSha256'];assert a['javascript']['sha256']!=b['javascript']['sha256'];assert a['appInventorySha256']!=b['appInventorySha256']
(r/'independent-verification.json').write_text(json.dumps({'checkedAt':int(time.time()*1000),'implementation':'independent Python hashlib/lstat; all app entries, HBC, phase logs, run artifacts, selected URL/path, runtime flags and generation/facts binding','runs':results,'fullSmokePass':all(x['exitStatus']==0 for x in results)},indent=2)+'\n')
print([(x['name'],x['commandMs']) for x in results])
