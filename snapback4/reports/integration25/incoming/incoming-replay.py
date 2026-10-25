from pathlib import Path
import hashlib,json,subprocess,os,sys,datetime
out=Path('/home/ccheever/sb4-loop/reports/integration25');binary=Path(os.environ['REL_BIN'])
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
paths=[]
for wave in [25,27]:
 for lane in sorted((Path.home()/f'sb4-loop/wave{wave}/apps').glob('*-snapback-*')):
  db=lane/'deploy/store.sqlite'
  if db.is_file():
   assert not db.is_symlink();paths.extend(p for p in [db,Path(str(db)+'-wal'),Path(str(db)+'-shm')] if p.is_file())
assert len([p for p in paths if p.name=='store.sqlite'])==100
before={str(p):sha(p) for p in paths}
binding={'binary':str(binary),'binarySha256':sha(binary),'sourceCommit':subprocess.check_output(['timeout','10s','git','rev-parse','HEAD'],text=True).strip(),'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'originalFilesBefore':before}
(out/'replay-incoming-binding.json').write_text(json.dumps(binding,indent=2)+'\n')
p=subprocess.run(['timeout','7200s','python3',str(out/'replay.py'),'incoming'],timeout=7210)
assert p.returncode==0,p.returncode
rows=json.loads((out/'replay/incoming.json').read_text());assert len(rows)==100
refusals={f"w{r['wave']}-{r['lane']}":r['refused'] for r in rows if r['refused']}
expected={'w25-004':5,'w25-024':5,'w25-030':2,'w25-045':2,'w27-012':2,'w27-042':2}
after={str(p):sha(p) for p in paths};assert before==after,'original store files changed';assert binding['binarySha256']==sha(binary)
success=[s for r in rows for s in r['steps'] if s['exit']==0]
summary={'stores':len(rows),'moves':sum(len(r['steps']) for r in rows),'knownTrueRefusals':refusals,'refusalsMatchREL':refusals==expected,'successfulMoves':len(success),'correctLiveLines':sum(s.get('liveLineCorrect',False) for s in success),'ordinarySourceForwards':sum(s['exit']==0 and s['move'].startswith('forward') and s['live'].get('exact',False) for r in rows for s in r['steps']),'hiddenV1Rows':sum(r['hidden'] for r in rows),'originalFilesUnchanged':len(before),'binarySha256':binding['binarySha256']}
(out/'replay-incoming-summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary),flush=True)
assert summary['refusalsMatchREL'] and summary['correctLiveLines']==len(success) and summary['hiddenV1Rows']==0
