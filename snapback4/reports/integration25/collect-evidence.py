from pathlib import Path
import json,gzip,hashlib,shutil,re,datetime
out=Path('/home/ccheever/sb4-loop/reports/integration25');repo=Path('/home/ccheever/projects/snapback-sb4loop');dest=out/'delivery';dest.mkdir(exist_ok=True)
def sha(b):return hashlib.sha256(b).hexdigest()
def packed(name,rows):
 data=''.join(json.dumps(r,separators=(',',':'))+'\n'for r in rows).encode();(dest/name).write_bytes(gzip.compress(data,compresslevel=9,mtime=0))
def calls(raw):
 return {k:{**{x:v[x]for x in ['argv','exit','seconds']if x in v},'stdoutTextSha256':sha(v.get('stdout','').encode()),'stderrTextSha256':sha(v.get('stderr','').encode())}for k,v in raw.items()}
rows=[json.loads(gzip.decompress(p.read_bytes()))for p in sorted((out/'survey-wave26-final').glob('w*.json.gz'))];assert len(rows)==650
packed('survey-projects.jsonl.gz',[{'project':r['project'],'wave':r['wave'],'sourceHashes':r['sourceHashes'],'fixtureHashes':r['fixtureHashes'],'gates':[{k:g[k]for k in ['code','site','id','gated','acknowledged','family']if k in g}for g in r['gates']],'calls':calls(r['calls'])}for r in rows])
audits=[json.loads(gzip.decompress(p.read_bytes()))for p in sorted((out/'survey-audit-final').glob('w*.json.gz'))];summary=json.loads((out/'survey-audit-final/summary.json').read_text());assert not summary['unresolved'];assert len(audits)==summary['audits']
packed('survey-conditional-audits.jsonl.gz',[{**{k:v for k,v in r.items()if k!='calls'},'calls':calls({str(i):c for i,c in enumerate(r['calls'])})}for r in audits])
replay=json.loads((out/'replay/final.json').read_text());assert len(replay)==100
compact=[]
for r in replay:
 row={k:v for k,v in r.items()if k!='steps'};row['steps']=[]
 for s in r['steps']:
  e={k:v for k,v in s.items()if k!='reason'}
  if 'reason'in s:e['reasonTextSha256']=sha(s['reason'].encode())
  folder=out/'replay/logs'/f"w{r['wave']}-{r['lane']}-final"
  for suffix in ['stdout','stderr']:e[f'{suffix}Sha256']=sha((folder/f"{s['move']}.{suffix}").read_bytes())
  row['steps'].append(e)
 compact.append(row)
packed('store-replay.jsonl.gz',compact)
for src,name in [('final-binary-binding.json','binary-binding.json'),('survey-wave26-final/binding.json','survey-binding.json'),('survey-wave26-final/summary.json','survey-summary.json'),('survey-audit-final/binding.json','audit-binding.json'),('survey-audit-final/summary.json','audit-summary.json'),('replay-final-binding.json','replay-binding.json'),('replay-final-summary.json','replay-summary.json')]:shutil.copyfile(out/src,dest/name)
analysis=json.loads((out/'replay-final-analysis.json').read_text());analysis['cases']=[{k:v for k,v in r.items()if k!='failedMoves'}for r in analysis['cases']];(dest/'replay-classification.json').write_text(json.dumps(analysis,indent=2)+'\n')
for n in ['survey.py','audit-survey.py','audit-survey-before-message-match.py','audit-survey-before-subject-match.py','replay.py','final-replay.py','collect-evidence.py']:shutil.copyfile(out/n,dest/n)
for n in ['audit-ambiguity-matching-control.json','audit-edit-subject-control.json','audit-final-initial-binding.json','audit-final-message-binding.json']:shutil.copyfile(out/n,dest/n)
summary={'helperSha256':{p.name:sha(p.read_bytes())for p in dest.glob('*.py')},'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':'70365904e65a71c3af923faedfc3b0713e3ee1a9','surveyProjects':len(rows),'conditionalAudits':len(audits),'replayStores':len(replay),'rawEvidenceRoot':str(out),'redaction':'Compact ledgers preserve result/identity/source/fixture hashes, decisions and conditional edits; stdout/stderr are content hashes. Private raw output and binaries stay local. No stores, account rosters or tokens are archived.'}
(dest/'campaign-provenance.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
