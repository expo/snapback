#!/usr/bin/env python3
"""Repair the original lane-041 poisoned store on private, disposable copies."""
import argparse,json,re,shutil,sqlite3,subprocess,tempfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--baseline',required=True);p.add_argument('--out',required=True);p.add_argument('--root',default=str(Path.home()/'sb4-loop/wave31/apps'));a=p.parse_args()
source=next(Path(a.root).glob('041-snapback-*'))/'tmp-repro5'
def run(binary,store,*args):
 r=subprocess.run([str(Path(binary).resolve()),'rollback',str(store),*args,'--json'],capture_output=True,text=True,timeout=180)
 try:value=json.loads(r.stdout)
 except ValueError:value={}
 return r.returncode,value,sorted(set(re.findall(r'\bE_ADOPT\b',r.stderr+r.stdout)))
results={}
for label,binary in [('baseline',a.baseline),('rel3',a.binary)]:
 with tempfile.TemporaryDirectory(prefix='rel3-041-repair-',dir='/tmp/rel3-replay')as temporary:
  store=Path(temporary)/'store';shutil.copytree(source,store,symlinks=True,ignore=shutil.ignore_patterns('*-owner','*-token','*-shm','.release-command'))
  for link in(store/'releases').glob('*/.snapback4/store.sqlite'):
   if link.is_symlink():link.unlink();link.symlink_to('../../../store.sqlite')
  db=sqlite3.connect(store/'store.sqlite');poisoned=db.execute("SELECT count(*) FROM _release_events WHERE operation='rollback' AND release=previous").fetchone()[0];db.close();assert poisoned>0
  code,value,codes=run(binary,store,'--to','latest','--exact','--check');result={'poisonedSelfEvents':poisoned,'previewExit':code,'codes':codes}
  if label=='baseline':assert code!=0 and codes==['E_ADOPT']
  else:
   assert code==0 and value['visibility']['hiddenRows']==0;result['hiddenRows']=0
   code,value,_=run(binary,store,'--to','latest','--exact');assert code==0;result['activationExit']=code
   db=sqlite3.connect(store/'store.sqlite');before=list(db.execute('SELECT id,operation,release,previous,generation FROM _release_events'));db.close()
   code,value,_=run(binary,store,'--to','latest');assert code==0 and value['unchanged']
   db=sqlite3.connect(store/'store.sqlite');assert before==list(db.execute('SELECT id,operation,release,previous,generation FROM _release_events'));db.close();result['redundantNoEvent']=True
  results[label]=result
Path(a.out).write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2))
