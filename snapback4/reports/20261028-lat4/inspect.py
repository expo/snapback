"""Same-version, read-only per-command controls on fresh private lane copies."""
import argparse,hashlib,json,pathlib,shutil
from deploy import lat3,canonical,artifacts,execute
ap=argparse.ArgumentParser();ap.add_argument('--before',type=pathlib.Path,required=True);ap.add_argument('--after',type=pathlib.Path,required=True);ap.add_argument('--out',type=pathlib.Path,required=True);a=ap.parse_args()
a.out.mkdir(parents=True,exist_ok=False,mode=0o700)
commands=[['--version'],['releases','deploy','--json'],['releases','deploy','current','--json'],['sql','\\dt','--release','deploy','--json']]
for index,source in enumerate(sorted(pathlib.Path('/home/ccheever/sb4-loop/wave33/apps').glob('*-snapback-*'))):
 case=a.out/source.name;case.mkdir();app=case/'app'
 try:
  lat3.copy_source(source,app)
  def digest():return hashlib.sha256(json.dumps({'store':canonical(app/'deploy/store.sqlite'),'releases':artifacts(app)},sort_keys=True,separators=(',',':')).encode()).hexdigest()
  initial=digest()
  for command in commands:
   label='version'if command[0]=='--version'else'current'if'current'in command else command[0]
   row={'lane':source.name,'command':label,'args':command}
   for variant,binary in ([('before',a.before),('after',a.after)]if index%2==0 else [('after',a.after),('before',a.before)]):
    row[variant]=execute(binary,app,command,case/(label+'-'+variant),False)
    row[variant]['canonicalStoreAndReleasesUnchanged']=digest()==initial
   row['identicalOutput']=all(row['before'][k]==row['after'][k]for k in ['code','stdoutSha256','stderrSha256'])
   with (a.out/'results.jsonl').open('a')as f:f.write(json.dumps(row)+'\n')
  print(source.name,'complete',flush=True)
 finally:
  if app.exists():shutil.rmtree(app)
