import contextlib,pathlib,sqlite3,shutil,subprocess,concurrent.futures,json,os,hashlib,re,tempfile
HOME=pathlib.Path.home();BASE=HOME/'sb4-loop/integ24';OUT=BASE/'replay-wave26-write40';OUT.mkdir(exist_ok=True)
APPS=HOME/'sb4-loop/wave25/apps';BIN='/home/ccheever/projects/snapback-sb4loop/snapback4/target/integ24-wave26-write40-bin/snapback4';OLD=str(BASE/'bin/snapback4-0.4.38')
def lane(args):
 app,upgrade=args;label=app.name+('-upgrade38'if upgrade else '-native');dest=OUT/(label+'.json')
 if dest.exists():return json.loads(dest.read_text())
 with tempfile.TemporaryDirectory(prefix='integ24-day2-')as tmp:
  root=pathlib.Path(tmp);shutil.copytree(app/'deploy',root/'deploy',ignore=shutil.ignore_patterns('store.sqlite-owner','store.sqlite-token','.release-command','.snapback4'))
  shutil.copytree(app/'snapback',root/'snapback',ignore=shutil.ignore_patterns('generated','security-reviews.json'))
  for directory in ['versions','v1']:
   if(app/directory).is_dir():shutil.copytree(app/directory,root/directory,ignore=shutil.ignore_patterns('generated','node_modules'))
  calls=[]
  def run(args,binary=BIN):
   r=subprocess.run(['timeout','240s',binary,*args],cwd=root,capture_output=True,text=True,timeout=250)
   try:j=json.loads(r.stdout)
   except:j={}
   calls.append(dict(argv=args,binary=pathlib.Path(binary).name,exit=r.returncode,stdout=r.stdout,stderr=r.stderr));return r,j
  oldtables=set()
  for q in (root/'deploy/releases/1/snapback').glob('*.q'):oldtables.update(re.findall(r'^table (\w+)',q.read_text(),re.M))
  def rows(onlyold=False):
   with contextlib.closing(sqlite3.connect(root/'deploy/store.sqlite'))as c:
    tables=['r']
    if onlyold:tables += [n for n in ['_dormant_rows','_dormant_narrow_rows']if c.execute("select 1 from sqlite_schema where name=?",(n,)).fetchone()]
    return {i for table in tables for n,i in c.execute('select c.name,r.id from '+table+' r join _catalog c on c.num=r.t')if not onlyold or n in oldtables}
  before=rows(True)
  if upgrade:
   r,j=run(['deploy','deploy','--schema','snapback','--json'],OLD)
   if r.returncode:
    item=dict(project=app.name,upgrade38=upgrade,baselineRefused=True,calls=calls);dest.write_text(json.dumps(item,indent=2));return item
  check,c=run(['deploy','deploy','--schema','snapback','--check','--json'])
  deploy,d=run(['deploy','deploy','--schema','snapback','--json'])
  if deploy.returncode==0:
   preview,p=run(['rollback','deploy','--to','1','--check','--json'])
   rb,b=run(['rollback','deploy','--to','1','--json'])
   hidden=len(before-rows()) if rb.returncode==0 else None
   fw,f=run(['rollback','deploy','--to','latest','--json'])
  else:preview=rb=fw=None;hidden=None;p={}
  item=dict(project=app.name,upgrade38=upgrade,baselineRefused=False,baselineV1Rows=len(before),check=check.returncode,deploy=deploy.returncode,rollbackCheck=preview.returncode if preview else None,rollback=rb.returncode if rb else None,forward=fw.returncode if fw else None,hiddenV1Rows=hidden,visibility=p.get('visibility'),calls=calls)
  dest.write_text(json.dumps(item,indent=2)+'\n');print(label,deploy.returncode,item['rollback'],hidden,flush=True);return item
items=[(app,u)for app in sorted(APPS.glob('*-snapback-*'))if(app/'deploy/store.sqlite').exists()for u in [False,True]]
with concurrent.futures.ThreadPoolExecutor(max_workers=3)as pool:results=list(pool.map(lane,items))
summary={}
for u in [False,True]:
 rows=[r for r in results if r['upgrade38']==u];summary['upgrade38'if u else'native']=dict(projects=len(rows),baselineRefused=sum(r.get('baselineRefused',False)for r in rows),deployAttempts=sum(r.get('deploy')is not None for r in rows),deployRefused=sum(r.get('deploy')not in[None,0]for r in rows),rollbackAttempts=sum(r.get('rollback')is not None for r in rows),rollbackRefused=sum(r.get('rollback')not in[None,0]for r in rows),forwardAttempts=sum(r.get('forward')is not None for r in rows),forwardRefused=sum(r.get('forward')not in[None,0]for r in rows),hiddenV1Rows=sum(r.get('hiddenV1Rows')or 0 for r in rows))
(OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(summary)
