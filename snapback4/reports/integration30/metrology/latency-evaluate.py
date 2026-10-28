from pathlib import Path
import json,hashlib
p=Path(__file__).parent
summary=json.loads((p/'latency-summary.json').read_text())
index={(r['cohort'],r['mode'],r['temperature'],r['label']):r for r in summary}
assert len(summary)==60
rows=json.loads((p/'latency-rows.json').read_text());assert len(rows)==1890
manifest=json.loads((p/'latency-capture-manifest.json').read_text());assert len(manifest)==63
for name,h in manifest.items():assert hashlib.sha256((p/'latency-raw'/name).read_bytes()).hexdigest()==h
assert not any(r['toolFailures']for r in summary)
regressions=[]
for key,r in index.items():
 if key[3]!='0.4.46':continue
 old=index[(*key[:3],'0.4.44')]
 for metric in ['median','p90']:
  if r[metric]>old[metric]:regressions.append(dict(cohort=key[0],mode=key[1],temperature=key[2],metric=metric,baseline=old[metric],candidate=r[metric]))
bars=[]
for cohort in ['sample54','day2-nine']:
 for mode,temp,metric,limit in [('check','cold','p90',10),('check','warm','median',2.5),('staging','cold','p90',15)]+([('preview',t,'p90',10)for t in ['cold','warm']]if cohort=='day2-nine'else[]):
  value=index[cohort,mode,temp,'0.4.46'][metric];bars.append(dict(cohort=cohort,mode=mode,temperature=temp,metric=metric,limit=limit,value=value,passed=value<=limit))
result=dict(schemas=63,invocations=1890,workers=4,bars=bars,regressionsVs044=regressions,toolFailures=[],allBarsPass=all(r['passed']for r in bars),noMedianOrP90RegressionVs044=not regressions,source='7aef642aa38471d70eca0128d0a5ddd3b4cf518a',sha256={f:hashlib.sha256((p/f).read_bytes()).hexdigest()for f in ['latency-summary.json','latency-rows.json','latency-capture-manifest.json','latency-provenance.json','latency.py']})
(p/'latency-verdict.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));assert result['allBarsPass']and result['noMedianOrP90RegressionVs044']
