#!/usr/bin/env python3
"""Hash and compare complete private counterexamples without printing their contents."""
import argparse,json,pathlib,hashlib
p=argparse.ArgumentParser();p.add_argument('--before',required=True);p.add_argument('--after',required=True);p.add_argument('--out',required=True);a=p.parse_args()
def load(path):return {(r['wave'],r['lane']):r for r in json.loads(pathlib.Path(path).read_text())}
def payload(r):return json.dumps(r,sort_keys=True,separators=(',',':')).encode()
before,after=load(a.before),load(a.after);missing=sorted(before.keys()-after.keys());extra=sorted(after.keys()-before.keys());changes=[];rows=[]
for key in sorted(before.keys()&after.keys()):
 b,c=payload(before[key]),payload(after[key]);same=b==c
 rows.append(dict(wave=key[0],lane=key[1],identical=same,beforeSha256=hashlib.sha256(b).hexdigest(),afterSha256=hashlib.sha256(c).hexdigest()))
 if not same:changes.append(dict(wave=key[0],lane=key[1],fields=[k for k in before[key]if before[key][k]!=after[key].get(k)]))
result=dict(schemas=len(before),missing=missing,extra=extra,changes=changes,rows=rows,identical=not(missing or extra or changes),method='Canonical JSON bytes of complete captured counterexample verdicts, including callers, arguments, row images, supporting rows and executed histories. No fields or scalars normalized/dropped. Raw payloads stay private.')
pathlib.Path(a.out).write_text(json.dumps(result,indent=2)+'\n');print('counterexample schemas',len(before),'missing',len(missing),'extra',len(extra),'changed',len(changes));raise SystemExit(not result['identical'])
