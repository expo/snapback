import json,os,shutil,subprocess,time,sys,re
from pathlib import Path
import tiktoken
enc=tiktoken.get_encoding('o200k_base'); out=Path(os.environ.get('TOK2_REPLAY_ROOT','/tmp/tok2'));phase=sys.argv[1];binary=str(Path(sys.argv[2]).resolve());results=[]
for lane in ['001-snapback-jukebox-restorations','027-snapback-animatronic-figure-builds','033-snapback-bathtub-reglazing-jobs']:
 src=Path.home()/'sb4-loop/wave33/apps'/lane;root=out/phase/lane
 if root.exists():shutil.rmtree(root)
 root.mkdir(parents=True)
 for name in ['snapback','fixtures','deploy']:
  if (src/name).exists():shutil.copytree(src/name,root/name,ignore=shutil.ignore_patterns('*-owner','*-control','*.sock','proof-accounts','*.token','node_modules','target','.release-command','*-address','*-lease','*-identity'))
 # Copying a quiescent lane's db/WAL bytes is not a database operation on it.
 db=root/'deploy/store.sqlite'
 if db.exists():(root/'deploy/store.sqlite-owner').touch(mode=0o600)
 commands=[['deploy','fresh'],['deploy','staging','--staging'],['deploy','deploy','--check'],['deploy','deploy','--check'],['releases','deploy'],['releases','deploy'],['rollback','deploy','--to','1','--check'],['rollback','deploy','--to','1'],['releases','deploy'],['deploy','deploy'],['releases','deploy']]
 # Pick a public stored table without reading/opening the original lane store.
 import sqlite3
 if db.exists():
  con=sqlite3.connect(db);con.close()
 source='\n'.join(f.read_text() for f in (root/'snapback').glob('*.q'))
 tables=re.findall(r'^table (\w+)',source,re.M)
 if tables: commands += [['data',tables[0],'--release','deploy'],['data',tables[0],'--release','deploy']]
 if lane.startswith('001'):commands += [['test','--fixture-only','--source','deploy/releases/1/snapback']]
 for cmd in commands:
  start=time.monotonic();p=subprocess.run([binary,*cmd],cwd=root,text=True,capture_output=True,timeout=600)
  text=p.stdout+p.stderr;name=f'{len(results):03d}'
  (root/(name+'.out')).write_text(text)
  results.append(dict(lane=lane,command=cmd,code=p.returncode,bytes=len(text.encode()),tokens=len(enc.encode(text,disallowed_special=())),lines=len(text.splitlines()),seconds=time.monotonic()-start,output=str(root/(name+'.out'))))
(out/(phase+'.json')).write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(dict(commands=len(results),tokens=sum(x['tokens'] for x in results))))
