from pathlib import Path
import json,hashlib,stat,struct,gzip,tarfile,time
r=Path('/Users/ccheever/sb4-np/evidence/round1')
def digest(b):return hashlib.sha256(b).hexdigest()
def inventory(root):
 rows=[]
 def walk(p):
  for f in sorted(p.iterdir(),key=lambda f:f.name):
   st=f.lstat(); row={'path':str(f.relative_to(root)),'mode':stat.S_IMODE(st.st_mode)}
   if f.is_symlink(): row.update(type='symlink',target=str(f.readlink())); rows.append(row)
   elif f.is_dir():row.update(type='directory');rows.append(row);walk(f)
   else:b=f.read_bytes();row.update(type='file',bytes=len(b),sha256=digest(b));rows.append(row)
 walk(root);return {'files':rows,'bytes':sum(x.get('bytes',0) for x in rows),'sha256':digest(json.dumps(rows,separators=(',',':'),ensure_ascii=False).encode())}
results=[]
for name in ['a-ownbuild-1',*[f'b-repack-{n}' for n in range(1,6)],'b-warm-ownbuild-1']:
 d=r/name; rec=d/('repack.json' if 'repack' in name else 'build.json')
 if not rec.exists():continue
 j=json.loads(rec.read_bytes()); app=Path(j['executedApp']['path']);inv=inventory(app);assert inv==j['executedApp']['inventory'],name
 js=(app/'main.jsbundle').read_bytes();assert js[:8].hex()=='c61fbc03c103191f';assert digest(js)==j['executedApp']['javascript']['sha256'];assert struct.unpack_from('<I',js,8)[0]==98
 for phase in j['phases']:assert digest((d/phase['log']).read_bytes())==phase['sha256']
 proof=d/'proof.json';run=d/('repack-smoke-ios-run.json' if 'repack' in name else 'smoke-ios-run.json'); rr=json.loads(run.read_bytes()); pp=json.loads(proof.read_bytes())
 assert digest(rec.read_bytes())==pp['preparation']['sha256']
 for key,a in rr['artifacts'].items():
  if not a:continue
  f=Path(a['path']);assert f.stat().st_size==a['bytes'] and digest(f.read_bytes())==a['sha256'],(name,key)
 results.append({'name':name,'buildReceiptSha256':digest(rec.read_bytes()),'proofSha256':digest(proof.read_bytes()),'nativeInventorySha256':digest(json.dumps(j['executedApp']['native'],separators=(',',':')).encode()),'appBytes':inv['bytes'],'appInventorySha256':inv['sha256'],'javascript':j['executedApp']['javascript'],'native':j['executedApp']['native'],'fingerprint':j['nativeFingerprint']['fingerprint']['hash'],'preparationMs':j['durationMs'],'phases':[{k:p[k] for k in ['label','durationMs','status']} for p in j['phases']],'runMs':rr.get('durationMs'),'commandMs':json.loads((r/(name+'-command.json')).read_bytes())['durationMs'],'segments':{k:{key:v.get(key) for key in ['status','durationMs','error']} for k,v in rr['segments'].items()},'exitStatus':rr['exitStatus']})
if len(results)>1:
 a=results[0]
 for b in results[1:]:
  if 'repack' not in b['name']: continue
  assert a['native']==b['native'];assert a['fingerprint']==b['fingerprint'];assert a['javascript']['sha256']!=b['javascript']['sha256'];assert a['appInventorySha256']!=b['appInventorySha256']
(r/'independent-verification.json').write_text(json.dumps({'checkedAt':int(time.time()*1000),'implementation':'independent Python hashlib/lstat traversal; recomputed all payload entries, HBC magic/version, preparation logs and run artifact hashes','runs':results,'fullSmokePass':bool(results) and all(x['exitStatus']==0 for x in results)},indent=2)+'\n')
print([(x['name'],x['preparationMs'],x['commandMs'],x['exitStatus']) for x in results])
