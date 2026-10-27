#!/usr/bin/env python3
"""Carry source-backed manual judgments by diagnostic property; expose new cases."""
import argparse,collections,gzip,hashlib,json,re,pathlib
p=argparse.ArgumentParser();p.add_argument('--manual',required=True);p.add_argument('--after',required=True);p.add_argument('--out',required=True);a=p.parse_args()
def read(path):
 raw=pathlib.Path(path).read_bytes();return json.loads(gzip.decompress(raw) if str(path).endswith('.gz') else raw)
manual=read(a.manual);rows=read(a.after);codes=set(manual['scope']['codes'])
def op(message):return re.match(r'(?:mutation |query )?([\w.]+)',message)[1]
def identity(lane,code,site,message):return (lane,code,site['file'],site['line'],site['col'],op(message))
index=collections.defaultdict(list)
for n in manual['notes']:
 index[identity(n['lane'],n['code'],n['site'],n['original_message'])].append(n)
result=[]
for row in rows:
 if row['wave']!=30:continue
 assert row['sha256']==next(l['source_bundle_sha256'] for l in manual['lanes'] if l['lane']==row['lane'])
 for i,n in enumerate(row['notes']):
  if n['code'] not in codes:continue
  matches=index[identity(row['lane'],n['code'],n['site'],n['message'])]
  # Same site can name different fields. Mixed judgments require manual review.
  classes={m['classification'] for m in matches}
  cls=next(iter(classes)) if len(classes)==1 else 'needs_manual_delta_review'
  result.append(dict(lane=row['lane'],note_index=i,**n,classification=cls,manual_ids=[m['id'] for m in matches],evidence=[m['evidence'] for m in matches],explanation=[m['explanation'] for m in matches]))
summary=collections.Counter(n['classification'] for n in result)
output=dict(provenance=dict(method='Reconcile unchanged-source manual note properties by lane/code/site/operation; mixed or new properties remain explicitly unclassified.',manual_sha256=hashlib.sha256(pathlib.Path(a.manual).read_bytes()).hexdigest(),after_sha256=hashlib.sha256(pathlib.Path(a.after).read_bytes()).hexdigest()),summary=dict(summary),notes=result)
pathlib.Path(a.out).write_text(json.dumps(output,indent=2)+'\n');print(json.dumps(dict(summary)))
