from pathlib import Path
import json,hashlib,stat,struct,time,urllib.parse
r=Path('/Users/ccheever/sb4-np/evidence/round4')
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
for name in ['a-ownbuild-1',*[f'b-warm-ownbuild-{n}' for n in range(1,6)]]:
 c=json.loads((r/(name+'-command.json')).read_text());assert c['exitStatus']==0
 d=r/name;rec=d/'build.json';j=json.loads(rec.read_text());app=Path(j['executedApp']['path']);inv=inventory(app);assert inv==j['executedApp']['inventory'],name
 assert stat.S_IMODE(rec.stat().st_mode)==0o444 and j['proofKind']=='application-release' and j['transformation'] is None
 native=[row for row in inv['files'] if row['type']=='file' and (app/row['path']).read_bytes()[:4].hex() in {'cffaedfe','feedfacf','cafebabe','bebafeca','cefaedfe'}];assert native==j['executedApp']['native'],name
 js=(app/'main.jsbundle').read_bytes();assert js[:8].hex()=='c61fbc03c103191f';assert digest(js)==j['executedApp']['javascript']['sha256'];assert struct.unpack_from('<I',js,8)[0]==98
 for phase in j['phases']:assert phase['status']==0 and digest((d/phase['log']).read_bytes())==phase['sha256']
 assert any(phase['label']=='xcode-build' for phase in j['phases']) and not any(phase['label']=='repack' for phase in j['phases'])
 assert inventory(d/'build.xcresult')==j['buildResult']
 for row in j['nativeClosure']['compiler']['records']:assert digest((d/'native-dependencies'/row['path']).read_bytes())==row['sha256']
 proof=d/'proof.json';rr=json.loads((d/'smoke-ios-run.json').read_text());pp=json.loads(proof.read_text())
 assert digest(rec.read_bytes())==pp['preparation']['sha256']==pp['nativeBase']['build']
 assert pp['proofKind']=='application-release' and pp['nativeBase']['app']==inv['sha256'] and rr['exitStatus']==0
 for key,a in rr['artifacts'].items():
  if not a:continue
  f=Path(a['path']);assert f.stat().st_size==a['bytes'] and digest(f.read_bytes())==a['sha256'],(name,key)
 receipts=[json.loads(line) for line in (d/'smoke-ios-receipts.jsonl').read_text().splitlines()]
 for segment in ['prime','offline','restart']:
  assert rr['segments'][segment]['status']=='passed'
  obs=[row['startup'] for row in receipts if row.get('startup',{}).get('segment')==segment];assert len(obs)==1
  o=obs[0];url=urllib.parse.urlparse(o['scriptURL']);assert url.scheme=='file' and not url.netloc and not url.query and not url.fragment
  assert urllib.parse.unquote(url.path)==o['selectedBundlePath']==pp['installedBundlePath']
  assert o['javascriptSha256']==digest(js) and o['proofSha256']==digest(proof.read_bytes()) and o['dev'] is False and o['release'] is True and o['hermes'] is True
  for key in ['launcherManifestPresent','updatesPresent','updatesManifestPresent']:assert o[key] is False
  assert o['nativeBase']==o['output']==inv['sha256']
  assert o['executableSha256']==next(x['sha256'] for x in native if x['path']==j['executedApp']['info']['CFBundleExecutable'])
  sm=rr['segments'][segment]['receipt'];assert sm['generation']==sm['queryGeneration']==rr['queryGeneration'];assert sm['queryFacts']==rr['queryFacts'];assert sm['pass'] is True
 probes=[x['np'] for x in receipts if 'historyCount' in x.get('np',{})];assert len(probes)==3
 for probe in probes:
  assert probe['marker']==('NP A' if name.startswith('a-') else 'NP B') and probe['historyCount']==8 and probe['font'] is True and probe['media']['local'] is True
 assert len([x for x in receipts if x.get('np',{}).get('imageLoaded') is True])==3
 helpers={f:digest((d/f).read_bytes()) for f in ['prepare.mjs','payload.mjs','native-inputs.mjs','native-closure.mjs','native-scripts.mjs']}
 results.append({'name':name,'cliSha256':c['cliSha256'],'helperHashes':helpers,'buildReceiptSha256':digest(rec.read_bytes()),'proofSha256':digest(proof.read_bytes()),'appBytes':inv['bytes'],'appInventorySha256':inv['sha256'],'javascript':j['executedApp']['javascript'],'native':j['executedApp']['native'],'fingerprint':j['nativeFingerprint']['fingerprint']['hash'],'preparationMs':j['durationMs'],'phases':[{k:p[k] for k in ['label','durationMs','status']} for p in j['phases']],'commandMs':c['durationMs'],'segments':{k:{key:v.get(key) for key in ['status','durationMs','error']} for k,v in rr['segments'].items()},'exitStatus':rr['exitStatus']})
a=results[0]
for b in results[1:]:
 assert a['javascript']['sha256']!=b['javascript']['sha256'] and a['appInventorySha256']!=b['appInventorySha256']
 assert a['helperHashes']==b['helperHashes'] and a['cliSha256']==b['cliSha256']
 for suffix in ['', '@2x','@3x']:
  rel='base.app/assets/assets/np/probe'+suffix+'.png';assert digest((r/a['name']/rel).read_bytes())!=digest((r/b['name']/rel).read_bytes())
(r/'independent-verification.json').write_text(json.dumps({'checkedAt':int(time.time()*1000),'implementation':'independent Python hashlib/lstat; every app entry, HBC, readonly receipt, build result, native records, phase/run hashes, actual selected bundle, runtime and query-generation binding, visible probe and A/B assets','runs':results,'fullSmokePass':True},indent=2)+'\n')
print([(x['name'],x['commandMs']) for x in results])
