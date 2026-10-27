from pathlib import Path
import json,tempfile,subprocess,shutil,concurrent.futures,hashlib,time
out=Path('/home/ccheever/sb4-loop/reports/integration28');home=Path.home()/'sb4-loop';keys=json.loads((out/'calibration-keys.json').read_text());binaries={'optimized':Path('/home/ccheever/projects/snapback-sb4loop/snapback4/target/x86_64-unknown-linux-musl/production/snapback4'),'sequential':out/'sequential-tier-binary'};rows=[]
def capture(key):
 wave,lane=key;source=home/f'wave{wave}/apps'/lane;values={}
 for label,binary in binaries.items():
  with tempfile.TemporaryDirectory(prefix='i28-production-final-identity-')as tmp:
   root=Path(tmp);(root/'snapback').mkdir()
   for q in(source/'snapback').glob('*.q'):shutil.copy2(q,root/'snapback'/q.name)
   for q in(source/'fixtures').rglob('*.jsonl'):
    target=root/'fixtures'/q.relative_to(source/'fixtures');target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(q,target)
   r=subprocess.run(['timeout','--kill-after=5s','600s',str(binary),'deploy','deployment','--json'],cwd=root,capture_output=True,text=True);assert r.returncode in[0,1],(key,label,r.returncode,r.stderr)
   j=json.loads(r.stdout);sec=j.get('security',{});sec=json.loads(sec)if isinstance(sec,str)else sec;assert sec,(key,label,j)
   report=sec['report'];verdicts=[]
   for v in report['invariants']:
    v=v.copy();v.pop('counterexample',None);verdicts.append(v)
   values[label]=dict(exit=r.returncode,reviews=sec['securityReviews'],notes=report['notes'],verdicts=verdicts,fixes=sec['fixes'],pending=sec['pending'],rawSecuritySha256=hashlib.sha256(json.dumps(sec,sort_keys=True).encode()).hexdigest())
 a,b=values.values();return dict(wave=wave,lane=lane,values=values,identityEqual=a['reviews']==b['reviews'],verdictEqual=all(a[k]==b[k]for k in ['exit','notes','verdicts','fixes','pending']),rawSecurityEqual=a['rawSecuritySha256']==b['rawSecuritySha256'])
with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:
 for row in pool.map(capture,keys):
  rows.append(row);(out/'production-final-identity-rows.json').write_text(json.dumps(rows,indent=2));print(len(rows),row['wave'],row['lane'],row['identityEqual'],row['verdictEqual'],row['rawSecurityEqual'],flush=True)
result=dict(schemas=len(rows),binaries={k:hashlib.sha256(v.read_bytes()).hexdigest()for k,v in binaries.items()},identityMismatches=[(r['wave'],r['lane'])for r in rows if not r['identityEqual']],verdictMismatches=[(r['wave'],r['lane'])for r in rows if not r['verdictEqual']],rawSecurityMismatches=[(r['wave'],r['lane'])for r in rows if not r['rawSecurityEqual']],method='Fresh production deploy on independent source/fixture copies, no predecessor invented. Final static production executable versus external sequential uncached control with identical merged rules. Exact full decision payloads and all verdict/obligation fields; raw complete security-envelope hashes separately retained. No normalization.')
(out/'production-final-identity-summary.json').write_text(json.dumps(result,indent=2));assert not(result['identityMismatches']or result['verdictMismatches']),result
