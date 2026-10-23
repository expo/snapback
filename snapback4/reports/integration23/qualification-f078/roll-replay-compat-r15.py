import json,subprocess,tempfile,shutil,pathlib,glob,sys,os,sqlite3
# Run with an explicit output directory; evidence sources are only copied.
ROOT=pathlib.Path(__file__).resolve().parents[2]
BIN=os.environ.get('SNAPBACK4_BIN',str(ROOT/'target/debug/snapback4'))
APPS=pathlib.Path(os.environ.get('ROLL_REPLAY_APPS',str(pathlib.Path.home()/'sb4-loop/wave23/apps')))
if not os.environ.get('ROLL_REPLAY_OUT'):raise SystemExit('Set ROLL_REPLAY_OUT to an evidence directory outside the checkout')
OUT=pathlib.Path(os.environ['ROLL_REPLAY_OUT']);OUT.mkdir(exist_ok=True,parents=True)
lanes=sys.argv[1:] or '003 007 011 013 015 018 019 023 027 028 031 032 033 035 041 047'.split()
results=[]
for lane in lanes:
 root=pathlib.Path(tempfile.mkdtemp(prefix='sb4-roll-lane-'+lane+'-'))
 try:
  src=pathlib.Path(glob.glob(str(APPS/(lane+'-snapback-*')))[0])
  shutil.copytree(src/'deploy',root/'deploy',ignore=shutil.ignore_patterns('store.sqlite','store.sqlite-wal','store.sqlite-shm','store.sqlite-owner','store.sqlite-token','.release-command','.snapback4'))
  with sqlite3.connect(f'file:{src / "deploy/store.sqlite"}?mode=ro',uri=True) as original, sqlite3.connect(root/'deploy/store.sqlite') as copied:
   original.execute('PRAGMA query_only=ON');original.backup(copied)
  shutil.copytree(src/'snapback',root/'snapback',ignore=shutil.ignore_patterns('generated'))
  for name in ['versions','v1','v2','rollback-v1']:
   if (src/name).is_dir():shutil.copytree(src/name,root/name,ignore=shutil.ignore_patterns('node_modules','dist','generated','.env','deploy','.snapback4'),dirs_exist_ok=True)
  def meta():
   with sqlite3.connect(root/'deploy/store.sqlite') as c:
    return dict(c.execute("SELECT key,value FROM _meta WHERE key IN ('version','release','generation')"))
  before_meta=meta()
  provenance=[json.loads(f.read_text()).get('cliVersion') for f in (src/'deploy/releases').glob('*/provenance.json')]
  calls=[]
  def run(args):
   r=subprocess.run(["timeout","90s",BIN,*args],cwd=root,capture_output=True,text=True,timeout=90)
   try:v=json.loads(r.stdout)
   except:v={}
   calls.append(dict(args=args,code=r.returncode,stdout=r.stdout,stderr=r.stderr));return r,v
  before,b=run(['rollback','deploy','--to','1','--exact','--check','--json'])
  preview,p=run(['deploy','deploy','--schema','snapback','--restore-dormant','--check','--json'])
  initial_refusal=preview.returncode
  repaired=False
  if lane=='032' and preview.returncode:
   schema=root/'snapback/schema.q'
   schema.write_text(schema.read_text()+"\ndown orders rollbackembargo(id: id): {embargo: embargoInstructions[order = id].requested ?? false}\n")
   preview,p=run(['deploy','deploy','--schema','snapback','--restore-dormant','--check','--json']);repaired=True
  if lane=='010' and preview.returncode:
   schema=root/'snapback/schema.q'
   original=schema.read_text();assert 'audienceSurfer' not in original
   schema.write_text(original.replace('table dings:\n','table dings:\n  audienceSurfer: principal ?\n  surfer: principal ?\n'))
   preview,p=run(['deploy','deploy','--schema','snapback','--restore-dormant','--check','--json']);repaired=True
  deploy,d=run(['deploy','deploy','--schema','snapback','--restore-dormant','--json'])
  after,a=run(['rollback','deploy','--to','1','--check','--json']) if deploy.returncode==0 else (deploy,{})
  stages=[]
  if after.returncode==0:
   for target in ['1','latest','1','latest']:
    r,v=run(['rollback','deploy','--to',target,'--json']);stages.append(dict(target=target,code=r.returncode))
  item=dict(lane=lane,beforeMetadata=before_meta,afterMetadata=meta(),historicalCliVersions=sorted(set(provenance)),initialRefusal=initial_refusal,authoredCompatibility=repaired,authoredCompatibilityKind=("retained nullable intermediate audience fields with current live-parent guards" if lane=="010" and repaired else "truthful embargo down" if repaired else None),beforeHidden=b.get('visibility',{}).get('hiddenRows'),preview=preview.returncode,deploy=deploy.returncode,afterHidden=a.get('visibility',{}).get('hiddenRows'),views=p.get('rollbackViews',[]),stages=stages,refusal=(preview.stderr[-1200:] if preview.returncode else after.stderr[-1200:] if after.returncode else None))

  results.append(item);(OUT/(lane+'.json')).write_text(json.dumps(dict(result=item,calls=calls),indent=2));print(json.dumps({k:v for k,v in item.items() if k!='views'}),flush=True)
 except Exception as e:results.append(dict(lane=lane,error=type(e).__name__));print(lane,type(e).__name__,flush=True)
 finally:shutil.rmtree(root)
(OUT/'summary.json').write_text(json.dumps(results,indent=2))
def qualified(item):
 return not item.get('error') and item.get('preview')==0 and item.get('deploy')==0 and item.get('afterHidden')==0 and len(item.get('stages',[]))==4 and all(stage['code']==0 for stage in item['stages'])
if not all(qualified(item) for item in results):sys.exit(1)
