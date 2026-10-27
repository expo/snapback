from pathlib import Path
import tempfile,concurrent.futures,subprocess,json,shutil,hashlib
out=Path('/home/ccheever/sb4-loop/reports/integration28');binary=out/'candidate-tier';sources=sorted((Path.home()/'sb4-loop/wave30/apps').glob('*/snapback'));rows=[]
def capture(folder):
 with tempfile.TemporaryDirectory(prefix='i28-identity-')as t:
  root=Path(t);(root/'snapback').mkdir()
  for q in folder.glob('*.q'):shutil.copy2(q,root/'snapback'/q.name)
  for q in(folder.parent/'fixtures').rglob('*.jsonl'):
   dest=root/'fixtures'/q.relative_to(folder.parent/'fixtures');dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(q,dest)
  def run():
   r=subprocess.run(['timeout','--kill-after=5s','600s',str(binary),'check','--review','--json'],cwd=root,capture_output=True,text=True);assert r.returncode in[0,1],r.stderr;j=json.loads(r.stdout)
   ds=j.get('securityReviews',[]);raw=json.dumps(ds,sort_keys=True)
   ids=[{k:d.get(k)for k in['id','code','site','gated','acknowledged']}|{'witness':(d.get('witness')or{}).get('id')}for d in ds]
   return dict(exit=r.returncode,rawSha256=hashlib.sha256(raw.encode()).hexdigest(),decisions=ids,notes=j.get('notes'),fixes=[dict(site=v['invariant']['site'],predicate=v['invariant']['predicate'],counterexample=v.get('counterexample'))for v in j.get('security',{}).get('invariants',[])if v.get('counterexample')])
  cold=run();warm=run();return dict(lane=folder.parent.name,cold=cold,warm=warm,rawDecisionPayloadEqual=cold['rawSha256']==warm['rawSha256'],identityEqual=cold['decisions']==warm['decisions'],exitsEqual=cold['exit']==warm['exit'])
with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:
 for r in pool.map(capture,sources):
  rows.append(r);(out/'identity-tier-rows.json').write_text(json.dumps(rows,indent=2));print(r['lane'],r['identityEqual'],r['rawDecisionPayloadEqual'],flush=True)
summary=dict(schemas=len(rows),binarySha256=hashlib.sha256(binary.read_bytes()).hexdigest(),method='Merged rules: expanded check --review on clean source/fixture copies, then identical warm read using advice cache. Gate replays remain live. Literal decision IDs, witness IDs, tiers and command outcomes compared. Raw payload equality is recorded separately; standalone-vs-reused-vs-pending report identity and batched-vs-independent compilation also have product unit assertions.',identityMismatches=[r['lane']for r in rows if not r['identityEqual']or not r['exitsEqual']],rawPayloadMismatches=[r['lane']for r in rows if not r['rawDecisionPayloadEqual']])
(out/'identity-tier-summary.json').write_text(json.dumps(summary,indent=2));assert not summary['identityMismatches'],summary
