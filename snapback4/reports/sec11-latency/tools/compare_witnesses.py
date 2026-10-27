#!/usr/bin/env python3
"""Hash and compare complete private counterexamples without printing their contents."""
import argparse,json,pathlib,hashlib
from witness_payload import canonical
p=argparse.ArgumentParser();p.add_argument('--before',required=True);p.add_argument('--after',required=True);p.add_argument('--out',required=True);p.add_argument('--types');a=p.parse_args()
types=json.loads(pathlib.Path(a.types).read_text())if a.types else {}
def load(path):return {(r['wave'],r['lane']):r for r in json.loads(pathlib.Path(path).read_text())}
def payload(r):return json.dumps(r,sort_keys=True,separators=(',',':')).encode()
before,after=load(a.before),load(a.after);missing=sorted(before.keys()-after.keys());extra=sorted(after.keys()-before.keys());changes=[];rows=[]
for key in sorted(before.keys()&after.keys()):
 raw_b,raw_c=payload(before[key]),payload(after[key]);b,c=raw_b,raw_c;counts=(0,0)
 if types:
  metadata=types[f'{key[0]}/{key[1]}'];assert metadata['sourceSha256']==before[key]['sha256']==after[key]['sha256'],'type/source mismatch'
  first,n=canonical(before[key],metadata['types']);second,m=canonical(after[key],metadata['types']);b,c=payload(first),payload(second);counts=(n,m)
 same=b==c
 rows.append(dict(wave=key[0],lane=key[1],identical=same,rawIdentical=raw_b==raw_c,uploadedAssets=counts,beforeSha256=hashlib.sha256(b).hexdigest(),afterSha256=hashlib.sha256(c).hexdigest(),beforeRawSha256=hashlib.sha256(raw_b).hexdigest(),afterRawSha256=hashlib.sha256(raw_c).hexdigest()))
 if not same:changes.append(dict(wave=key[0],lane=key[1],fields=[k for k in before[key]if before[key][k]!=after[key].get(k)]))
result=dict(schemas=len(before),missing=missing,extra=extra,changes=changes,rows=rows,identical=not(missing or extra or changes),method='Complete counterexample JSON, including callers, arguments, rows, supporting worlds and histories. With --types, only nominal uploaded-asset IDs found in compiler-typed asset slots receive injective aliases; all facts, equality edges, other IDs and opaque values remain. Raw hashes and literal equality are retained; raw payloads stay private.')
pathlib.Path(a.out).write_text(json.dumps(result,indent=2)+'\n');print('counterexample schemas',len(before),'missing',len(missing),'extra',len(extra),'changed',len(changes));raise SystemExit(not result['identical'])
