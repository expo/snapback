"""Merge disjoint, completed survey shards; retain source/binary provenance."""
import argparse,collections,gzip,hashlib,json,pathlib
p=argparse.ArgumentParser();p.add_argument('--part',action='append',required=True);p.add_argument('--provenance',required=True);p.add_argument('--out',required=True);p.add_argument('--expected',type=int,default=800);p.add_argument('--baseline',default='snapback4/reports/sec11-item1/survey-all800.json.gz');a=p.parse_args()
provenance=json.loads(pathlib.Path(a.provenance).read_text());expected_binary=provenance['binarySha256'];baseline=json.load(gzip.open(a.baseline,'rt'));sources={(r['wave'],r['lane']):r['sha256']for r in baseline};combined={};parts=[]
for value in a.part:
 label,directory=value.split('=',1);root=pathlib.Path(directory);raw=(root/'results.json').read_bytes();rows=json.loads(raw);measurement=json.loads((root/'measurement.json').read_text());assert measurement['binarySha256']==expected_binary,(label,'binary mismatch')
 assert len(rows)==measurement['projects'],(label,'partial shard')
 for row in rows:
  key=(row['wave'],row['lane']);assert key not in combined,(label,'overlapping shard',key);assert row['sha256']==sources[key],(label,'source mismatch',key)
  assert all(field in row for field in ['defaultCheck','defaultDeploy','fresh','test','afterTest','reviews','notes','gates','checkExit']), (label,'incomplete measurement record',key)
  combined[key]=row
 parts.append(dict(label=label,directory=str(root),schemas=len(rows),resultsSha256=hashlib.sha256(raw).hexdigest(),measurement=measurement))
assert len(combined)==a.expected,(len(combined),a.expected)
assert set(combined)==set(sources),'source population differs from the retained 800-schema baseline'
out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True);rows=sorted(combined.values(),key=lambda r:(r['wave'],r['lane']));(out/'results.json').write_text(json.dumps(rows,indent=2)+'\n')
receipt=dict(kind='composed-disjoint-shards',binarySha256=expected_binary,projects=len(rows),sourceHashesMatch=True,parts=parts,scope='All phases are actual command attempts on copied schemas. Original interrupted runs and any incomplete test subcampaigns remain separately recorded; no parent run is relabeled PASS.')
(out/'measurement.json').write_text(json.dumps(receipt,indent=2)+'\n');(out/'composition.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(dict(schemas=len(rows),binarySha256=expected_binary,parts={p['label']:p['schemas']for p in parts}),indent=2))
