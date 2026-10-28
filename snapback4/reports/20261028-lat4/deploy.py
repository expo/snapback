"""Canonical store and release identity on independently copied wave-33 deployments.
Clock-controlled identity is separate from unmodified-clock wall-time qualification.
"""
import argparse,collections,hashlib,importlib.util,json,os,pathlib,shutil,sqlite3,subprocess,time
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('lat3',HERE.parent/'20261027-lat3/replay.py');lat3=importlib.util.module_from_spec(spec);spec.loader.exec_module(lat3)
ROOT=pathlib.Path('/tmp/lat4/deploy')
def canonical(path):
 conn=sqlite3.connect(f'file:{path}?mode=ro',uri=True)
 # Complete schema plus all columns/rows of every table, including metadata,
 # history, dormant state and receipts; no column or table is normalized away.
 schema=conn.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_autoindex_%' ORDER BY type,name").fetchall()
 tables={}
 for (name,) in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
  quote='"'+name.replace('"','""')+'"';rows=conn.execute('SELECT * FROM '+quote).fetchall()
  def cell(v):return {'blob':v.hex()} if isinstance(v,bytes) else v
  tables[name]=sorted([[cell(v)for v in row]for row in rows],key=lambda row:json.dumps(row,sort_keys=True))
 conn.close();return {'schema':schema,'tables':tables}
def artifacts(app):
 result={}
 for p in sorted((app/'deploy/releases').rglob('*')):
  if p.is_file() and not p.is_symlink():
   b=p.read_bytes()
   # worker-package.json intentionally records the relocated host package root.
   # Both variants run at the same app path in this identity control, so no
   # normalization is necessary even for this location record.
   result[str(p.relative_to(app/'deploy/releases'))]=hashlib.sha256(b).hexdigest()
 return result

def execute(binary,app,args,log,clock):
 trace=log.with_suffix('.trace.jsonl');env={**os.environ,'SNAPBACK4_LATENCY_TRACE':str(trace)}
 if clock:env['LD_PRELOAD']='/tmp/lat4/fixed-clock.so'
 start=time.monotonic();r=subprocess.run([str(binary),*args],cwd=app,env=env,capture_output=True,timeout=900);seconds=time.monotonic()-start
 log.with_suffix('.stdout').write_bytes(r.stdout);log.with_suffix('.stderr').write_bytes(r.stderr)
 phases=collections.defaultdict(float)
 if trace.exists():
  for line in trace.read_text().splitlines():
   x=json.loads(line);phases[x['phase']]+=x['seconds']
 return {'code':r.returncode,'seconds':seconds,'preflightSeconds':phases['deploy.security'],'withoutPreflightSeconds':seconds-phases['deploy.security'],'phases':dict(phases),'stdoutSha256':hashlib.sha256(r.stdout).hexdigest(),'stderrSha256':hashlib.sha256(r.stderr).hexdigest()}

def main():
 global ROOT
 ap=argparse.ArgumentParser();ap.add_argument('--before',type=pathlib.Path,required=True);ap.add_argument('--after',type=pathlib.Path,required=True);ap.add_argument('--worker',type=int,default=0);ap.add_argument('--workers',type=int,default=1);ap.add_argument('--lanes');ap.add_argument('--clock-control',action='store_true');ap.add_argument('--out',type=pathlib.Path);a=ap.parse_args();ROOT=a.out or ROOT;ROOT.mkdir(parents=True,exist_ok=True)
 cases=sorted(pathlib.Path('/home/ccheever/sb4-loop/wave33/apps').glob('*-snapback-*'))
 if a.lanes:cases=[p for p in cases if p.name[:3]in a.lanes.split(',')]
 for index,source in enumerate(cases):
  if index%a.workers!=a.worker:continue
  case=ROOT/source.name;case.mkdir(exist_ok=True);base=case/'base';app=case/'app'
  try:
   lat3.copy_source(source,base)
   if not (base/'deploy/store.sqlite').is_file():raise RuntimeError('no deployment')
   # Same pathname for both copies makes path-bearing records literally equal.
   # Each starts from the untouched base tree; no prior result enters the other.
   for scenario in ['unchanged','reactivate','new-release']:
    row={'lane':source.name,'scenario':scenario,'clockControl':a.clock_control,'beforeBinarySha256':hashlib.sha256(a.before.read_bytes()).hexdigest(),'afterBinarySha256':hashlib.sha256(a.after.read_bytes()).hexdigest()};identities={}
    for variant,binary in ([('before',a.before),('after',a.after)]if index%2==0 else [('after',a.after),('before',a.before)]):
     if app.exists():shutil.rmtree(app)
     lat3.copy_source(base,app)
     if scenario=='reactivate':
      prepared=execute(binary,app,['rollback','deploy','--to','1','--json'],case/f'{scenario}-{variant}-rollback',a.clock_control)
      if prepared['code']!=0:raise RuntimeError('rollback setup refused')
     if scenario=='new-release':(app/'snapback/lat4.q').write_text('query ready():\n  return true\n')
     result=execute(binary,app,['deploy','deploy','--schema','snapback','--restore-dormant','--json'],case/f'{scenario}-{variant}',a.clock_control);row[variant]=result
     dump=canonical(app/'deploy/store.sqlite');encoded=json.dumps(dump,sort_keys=True,separators=(',',':')).encode();(case/f'{scenario}-{variant}.canonical.json').write_bytes(encoded)
     identities[variant]={'storeSha256':hashlib.sha256(encoded).hexdigest(),'releaseFiles':artifacts(app)}
    row['identities']=identities;row['sameStore']=identities['before']['storeSha256']==identities['after']['storeSha256'];row['sameReleaseFiles']=identities['before']['releaseFiles']==identities['after']['releaseFiles'];row['sameOutput']=all(row['before'][key]==row['after'][key]for key in ['code','stdoutSha256','stderrSha256'])
    with (ROOT/f'results-{a.worker}.jsonl').open('a')as f:f.write(json.dumps(row)+'\n')
    print(source.name,scenario,*[round(row[v]['withoutPreflightSeconds'],3)for v in ['before','after']],row['sameStore'],row['sameReleaseFiles'],row['sameOutput'],flush=True)
  except Exception as error:
   with (ROOT/f'results-{a.worker}.jsonl').open('a')as f:f.write(json.dumps({'lane':source.name,'setupError':str(error)})+'\n')
   print(source.name,'ERROR',str(error),flush=True)
  finally:
   for p in [base,app]:
    if p.exists():shutil.rmtree(p)
if __name__=='__main__':main()
