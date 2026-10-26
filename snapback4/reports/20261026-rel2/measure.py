#!/usr/bin/env python3
"""Replay release transitions on private copies of frozen bakeoff stores.

Never opens a source database in SQLite. Copies DB/WAL together, excludes owner
and credential/control sidecars, retargets release store links, and opens only
private copies. Output includes refusal codes and schema shapes, never credentials.
"""
import argparse,concurrent.futures,hashlib,json,os,re,shutil,sqlite3,subprocess,tempfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--out',required=True);p.add_argument('--waves',default='25,27,29');p.add_argument('--root',default=str(Path.home()/'sb4-loop'));p.add_argument('--workers',type=int,default=4);p.add_argument('--lanes',default='');a=p.parse_args();binary=str(Path(a.binary).resolve())
base=Path(a.root)

def copy(lane,dst):
 def ignore(d,names):
  return [n for n in names if n in ['node_modules','generated','proof-accounts','.release-command','.git','assets-tmp'] or n.endswith(('-owner','-token','-shm'))]
 for name in ['deploy','snapback','versions']:
  if (lane/name).exists():shutil.copytree(lane/name,dst/name,symlinks=True,ignore=ignore)
 config=dst/'snapback/client-compatibility.json'
 if config.exists():
  data=json.loads(config.read_text());original=lane/data['baseline']
  if original.exists():
   captured=dst/'rel2-client-baseline'
   if original.is_dir():
    captured.mkdir(exist_ok=True)
    for q in original.glob('*.q'):shutil.copyfile(q,captured/q.name)
   else:captured=captured.with_suffix('.q');shutil.copyfile(original,captured)
   data['baseline']=str(captured.relative_to(dst));config.write_text(json.dumps(data))
 for link in (dst/'deploy/releases').glob('*/.snapback4/store.sqlite'):
  if link.is_symlink():link.unlink();link.symlink_to('../../../store.sqlite')
 # Open only the copied bytes, including their copied WAL, never the source.
 conn=sqlite3.connect(dst/'deploy/store.sqlite');conn.execute('PRAGMA wal_checkpoint(TRUNCATE)');conn.close()

def invoke(cwd,args):
 try:
  r=subprocess.run([binary,*args],cwd=cwd,capture_output=True,text=True,timeout=180)
  j=None
  try:j=json.loads(r.stdout)
  except Exception:pass
  # Only return stable refusal labels, never data/credentials or raw diagnostics.
  codes=sorted(set(re.findall(r'\bE_[A-Z_]+\b',r.stderr)))
  return r.returncode,j,codes
 except subprocess.TimeoutExpired:return 124,None,['TIMEOUT']

def tablecols(path):
 out={}
 for q in sorted((path/'snapback').glob('*.q')):
  current=None
  for line in q.read_text().splitlines():
   m=re.match(r'^table (\w+)',line)
   if m:current=m[1];out[current]=set();continue
   if line and not line[0].isspace() and not line.startswith('--'):current=None
   m=re.match(r'^  (\w+):',line)
   if current and m:out[current].add(m[1])
 return out

def rows(path,predecessor,include_dormant=False):
 conn=sqlite3.connect(path)
 # Inspect catalog once on a copy; store SQL wire r rows carry tagged Row objects.
 names={number:name for name,number in conn.execute('SELECT name,num FROM _catalog')}
 tables={r[0] for r in conn.execute("SELECT name FROM sqlite_schema WHERE type='table'")}
 aliases=dict(conn.execute('SELECT name,origin FROM _table_renames')) if '_table_renames' in tables else {}
 origins={aliases.get(name,name) for name in predecessor}
 selected={t for t,name in names.items() if aliases.get(name,name) in origins}
 sources=['r']+([name for name in ['_dormant_rows','_dormant_narrow_rows'] if name in tables] if include_dormant else [])
 out={(t,rid) for source in sources for t,rid in conn.execute(f'SELECT t,id FROM {source}') if t in selected}
 conn.close();return out

def run(item):
 wave,lane=item;result={'wave':wave,'lane':lane.name[:3]}
 with tempfile.TemporaryDirectory(prefix='rel2-store-') as tmp:
  dst=Path(tmp);copy(lane,dst);dep=dst/'deploy'
  rc,status,codes=invoke(dst,['releases','deploy','--json']);result['inspect']={'exit':rc,'codes':codes}
  if not status:return result
  latest=status['latest'];result['latest']=latest
  rc,j,codes=invoke(dst,['rollback','deploy','--to',str(latest),'--json']);result['startForward']={'exit':rc,'codes':codes}
  beforecols=tablecols(dep/'releases/1');before=rows(dep/'store.sqlite',beforecols,True)
  rc,j,codes=invoke(dst,['deploy','deploy','--json']);result['deploy']={'exit':rc,'codes':codes}
  rc,updated,_=invoke(dst,['releases','deploy','--json']);latest=(updated or status)['latest']
  # Deploy may be refused by genuine reviews. Rollback still tests the retained source.
  rc,j,codes=invoke(dst,['rollback','deploy','--to','1','--exact','--check','--json']);result['exact']={'exit':rc,'codes':codes,'visibility':j.get('visibility') if j else None}
  for cycle in range(2):
   rc,preview,codes=invoke(dst,['rollback','deploy','--to','1','--check','--json'])
   check={'exit':rc,'codes':codes,'rowShape':preview.get('rowShape') if preview else None}
   rc,selected,codes=invoke(dst,['rollback','deploy','--to','1','--json'])
   move={'exit':rc,'codes':codes,'preview':check}
   if selected:
    live=selected.get('live',{});release=selected.get('release');move.update({'release':release,'exact':live.get('exact'),'target':live.get('target'),'rowShape':live.get('rowShape')})
    actualcols=tablecols(dep/f'releases/{release}')
    move['missingColumns']={t:sorted(c-actualcols.get(t,set())) for t,c in beforecols.items() if c-actualcols.get(t,set())}
    after=rows(dep/'store.sqlite',beforecols);move['hiddenV1Rows']=len(before-after) if before is not None and after is not None else None
    r,s,c=invoke(dst,['releases','deploy','--json']);move['shapeFieldConsistent']=bool(s and s.get('rowShape')==move['rowShape']==(preview or {}).get('rowShape')) if move['rowShape'] else None
   result[f'rollback{cycle+1}']=move
   rc,j,codes=invoke(dst,['deploy','deploy','--json']);result[f'forward{cycle+1}']={'exit':rc,'codes':codes}
 return result
items=[]
for wave in map(int,a.waves.split(',')):
 for lane in sorted((base/f'wave{wave}/apps').glob('*-snapback-*')):
  if a.lanes and lane.name[:3] not in a.lanes.split(','):continue
  items.append((wave,lane))
result={'binary':binary,'sha256':hashlib.sha256(Path(binary).read_bytes()).hexdigest(),'results':[]}
with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,a.workers)) as pool:
 for r in pool.map(run,items):
  result['results'].append(r);Path(a.out).write_text(json.dumps(result,indent=2))
  print(r['wave'],r['lane'],'deploy',r.get('deploy',{}).get('exit'),'rollback',r.get('rollback1',{}).get('exit'),'exact',r.get('rollback1',{}).get('exact'),'hidden',r.get('rollback1',{}).get('hiddenV1Rows'),flush=True)
