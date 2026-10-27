"""Compose complete survey with explicit, same-input watchdog retry provenance."""
import argparse,gzip,hashlib,json,pathlib
p=argparse.ArgumentParser();p.add_argument('--initial',required=True);p.add_argument('--retry',action='append',default=[]);p.add_argument('--out',required=True);a=p.parse_args()
initial=pathlib.Path(a.initial);out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True)
manifest=json.loads((initial/'measurement.json').read_text());rows=json.loads((initial/'results.json').read_text());assert len(rows)==800
key=lambda r:(r['wave'],r['lane'])
def bad(r):
 return r['checkExit']not in [0,1]or any(s.get('exit')not in [0,1]or '(time)'in str(s.get('failure',{}))or 'runtime panic'in str(s.get('failure',{}))for s in [r.get(k,{})for k in ['defaultCheck','defaultDeploy','fresh','test','afterTest']])
index={key(r):r for r in rows};choices={key(r):'initial'for r in rows};receipts=[]
def save(name,values):
 with gzip.open(out/name,'wt')as f:json.dump(values,f)
save('survey-initial.json.gz',rows)
for n,path in enumerate(a.retry,1):
 root=pathlib.Path(path);m=json.loads((root/'measurement.json').read_text());assert m['binarySha256']==manifest['binarySha256'],'binary changed'
 retries=[json.loads(f.read_text())for f in sorted(root.glob('w*.json'))]
 for r in retries:
  k=key(r);assert k in index and r['sha256']==index[k]['sha256'],'source changed'
  if bad(index[k])and not bad(r):index[k]=r;choices[k]=f'retry-{n}'
 save(f'survey-retry-{n}.json.gz',retries);receipts.append(dict(directory=str(root),measurement=m,completed=len(retries)))
qualified=sorted(index.values(),key=key);(out/'results.json').write_text(json.dumps(qualified,indent=2)+'\n')
provenance=dict(binarySha256=manifest['binarySha256'],initial=manifest,retries=receipts,selected=[dict(wave=k[0],lane=k[1],source=v)for k,v in sorted(choices.items())if v!='initial'],unresolved=[dict(wave=r['wave'],lane=r['lane'])for r in qualified if bad(r)])
(out/'composition.json').write_text(json.dumps(provenance,indent=2)+'\n');print(json.dumps(dict(retried=len(provenance['selected']),unresolved=provenance['unresolved']),indent=2))
