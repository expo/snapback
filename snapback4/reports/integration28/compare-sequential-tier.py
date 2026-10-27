from pathlib import Path
import json,tempfile,concurrent.futures,subprocess,shutil,hashlib,time
out=Path('/home/ccheever/sb4-loop/reports/integration28');base=Path.home()/'sb4-loop';keys=[v for v in json.loads((out/'survey-keys.json').read_text())if v[0]==30];keys+=[v for v in json.loads((out/'calibration-keys.json').read_text())if v[0]!=30];rows=[]
binaries={'optimized':out/'candidate-tier','sequential':out/'sequential-tier-binary'}
def capture(key):
 wave,lane=key;source=base/f'wave{wave}/apps'/lane;values={}
 for label,binary in binaries.items():
  with tempfile.TemporaryDirectory(prefix='i28-sequential-identity-')as tmp:
   root=Path(tmp);(root/'snapback').mkdir()
   for q in(source/'snapback').glob('*.q'):shutil.copy2(q,root/'snapback'/q.name)
   for q in(source/'fixtures').rglob('*.jsonl'):
    target=root/'fixtures'/q.relative_to(source/'fixtures');target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(q,target)
   if wave==31:
    prior=base/'wave31/v1-clients'/lane/'snapback';(root/'.snapback4').mkdir();(root/'.snapback4/security-write-baseline.json').write_text(json.dumps([(q.name,q.read_text())for q in sorted(prior.glob('*.q'))]))
   start=time.monotonic();r=subprocess.run(['timeout','--kill-after=5s','900s',str(binary),'check','--review','--json'],cwd=root,capture_output=True,text=True);assert r.returncode in[0,1],(key,label,r.returncode,r.stderr);j=json.loads(r.stdout);ds=j.get('securityReviews',[])
   values[label]=dict(exit=r.returncode,seconds=round(time.monotonic()-start,3),reviews=ds,identities=[{k:d.get(k)for k in ['id','code','site','gated','acknowledged']}|{'witness':(d.get('witness')or{}).get('id')}for d in ds],notes=j.get('notes'),securityNotes=j.get('security',{}).get('notes'),fixes=[dict(site=v['invariant']['site'],predicate=v['invariant']['predicate'])for v in j.get('security',{}).get('invariants',[])if v.get('counterexample')and v['counterexample'].get('reachability')in['authored-fixture-trace','generated-fixture-trace']])
 a,b=values.values();return dict(wave=wave,lane=lane,values=values,identityEqual=a['identities']==b['identities'],rawPayloadEqual=a['reviews']==b['reviews'],verdictEqual=all(a[k]==b[k]for k in ['exit','notes','securityNotes','fixes']))
with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:
 for row in pool.map(capture,keys):
  rows.append(row);(out/'sequential-tier-comparison-rows.json').write_text(json.dumps(rows,indent=2));print(len(rows),len(keys),row['wave'],row['lane'],row['identityEqual'],row['rawPayloadEqual'],row['verdictEqual'],flush=True)
summary=dict(schemas=len(rows),binaries={label:hashlib.sha256(p.read_bytes()).hexdigest()for label,p in binaries.items()},identityMismatches=[(r['wave'],r['lane'])for r in rows if not r['identityEqual']],rawPayloadMismatches=[(r['wave'],r['lane'])for r in rows if not r['rawPayloadEqual']],verdictMismatches=[(r['wave'],r['lane'])for r in rows if not r['verdictEqual']],method='Merged rule set: same immutable source/fixture copies, wave31 exact local predecessor, independent cold copies per executable. External control disables batching, concurrency, advisory/report reuse and asset-byte cache. Literal decision IDs, witness IDs, tiers, exits, notes and FIX identities; raw full decision payload separately checked without normalization. Fixture-constructor representation remains optimized in both and has focused isolation/page-size/captured-authority tests.')
(out/'sequential-tier-comparison-summary.json').write_text(json.dumps(summary,indent=2));assert not(summary['identityMismatches']or summary['verdictMismatches']),summary
