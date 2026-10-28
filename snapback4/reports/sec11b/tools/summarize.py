"""Summarize actual copied-schema runs; never classify an unmatched gate."""
import argparse, collections, gzip, hashlib, json, math, pathlib, statistics
p=argparse.ArgumentParser();p.add_argument('survey');p.add_argument('out');a=p.parse_args()
root=pathlib.Path(a.survey);rows=json.loads((root/'results.json').read_text());out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True)
def metric(field):
 xs=sorted(r[field]['lines']for r in rows);return dict(median=statistics.median(xs),p90=xs[math.ceil(.9*len(xs))-1],max=max(xs))
summary=dict(schemas=len(rows),defaultCheckLines=metric('defaultCheck'),defaultDeployLines=metric('defaultDeploy'),freshExits=dict(collections.Counter(r['fresh']['exit']for r in rows)),postTestExits=dict(collections.Counter(r['afterTest']['exit']for r in rows)),testExits=dict(collections.Counter(r['test']['exit']for r in rows)),toolFailures=[dict(wave=r['wave'],lane=r['lane'])for r in rows if any(r[k]['exit']not in [0,1]for k in ['fresh','afterTest','test'])or r['checkExit']not in [0,1]])
(out/'measurement.json').write_text(json.dumps(summary,indent=2)+'\n')
with gzip.open(out/'survey-all800.json.gz','wt')as f:json.dump(rows,f)
print(json.dumps(summary,indent=2))
