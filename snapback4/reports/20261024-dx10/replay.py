"""Read-only wave-27 source -> private copies; reports counts/status, never child output."""
import concurrent.futures,hashlib,json,os,re,shutil,sqlite3,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]; SB=ROOT/'snapback4'; EVIDENCE=Path.home()/'sb4-loop/wave27/apps'
SCRATCH=Path('/tmp/dx10-replay'); OUT=SB/'reports/20261024-dx10'/os.environ.get('DX10_REPLAY_OUT','replay.json')
# §7 process-driver rows (16 summary/detail matches plus 021's npm argv misuse).
PROCESS=['003','005','009','011','013','015','019','020','021','024','030','033','034','044','045','049','050']
POLLUTION=['010','024','037','040','044','049']
def run(args,cwd,env,timeout=180):
 p=subprocess.run(args,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
 return p

def counts(app):
 db=sqlite3.connect('file:'+str(app/'deploy/store.sqlite')+'?mode=ro',uri=True)
 try:return {'principals':db.execute('select count(*) from _principals').fetchone()[0], 'appRows':db.execute('select count(*) from r').fetchone()[0]}
 finally:db.close()
def main():
 if SCRATCH.exists():raise RuntimeError('refuse existing scratch')
 SCRATCH.mkdir(mode=0o700);results=[];metadata={'binarySha256':hashlib.sha256((SB/'target/debug/snapback4').read_bytes()).hexdigest(),'sourceSha256':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (SB/'packages/snapback4/src').glob('proof*.ts')}}
 try:
  pack=SCRATCH/'packed';pack.mkdir();p=run(['npm','pack','--ignore-scripts','--json','--pack-destination',str(pack)],SB/'packages/snapback4',os.environ.copy());p.check_returncode();filename=json.loads(p.stdout)[0]['filename'];subprocess.run(['tar','-xzf',str(pack/filename),'-C',str(pack)],check=True);metadata['packageSha256']=hashlib.sha256((pack/filename).read_bytes()).hexdigest()
  modules=SCRATCH/'node_modules';modules.mkdir()
  for f in (SB/'node_modules').iterdir():
   if f.name not in ['snapback4','.bin']:(modules/f.name).symlink_to(f.resolve())
  (modules/'snapback4').symlink_to(pack/'package')
  (modules/'.bin').mkdir()
  (modules/'.bin/snapback4').symlink_to(pack/'package/bin/snapback4.js')
  (modules/'.bin/tsx').symlink_to('/tmp/dx10-tools/node_modules/.bin/tsx')
  def work(number):
   source=next(EVIDENCE.glob(number+'-snapback-*'));app=SCRATCH/source.name
   shutil.copytree(source,app,symlinks=True,ignore=shutil.ignore_patterns('node_modules','logs','target','.git','dist','.expo','store.sqlite-wal','store.sqlite-shm','*.sock'))
   (app/'node_modules').symlink_to(modules);env={**os.environ,'SNAPBACK4_BIN':str(SB/'target/debug/snapback4'),'PORT_LO':str(27000+int(number)*10),'PORT_HI':str(27009+int(number)*10)}
   # Stay inside copies even if a package script uses npx.
   record={'lane':source.name,'script':json.loads((app/'package.json').read_text())['scripts'].get('prod:serve'),'attempts':[]}
   attempts=3 if number in POLLUTION else 1
   for i in range(attempts):
    before=counts(app);started=time.monotonic()
    p=run(['node',str(pack/'package/bin/snapback4.js'),'serve-check','--deployment','deploy','--script','prod:serve'],app,env,timeout=300)
    try:report=json.loads(p.stdout)
    except Exception:report={'ok':False,'unparsed':True,'stdoutSha256':hashlib.sha256(p.stdout).hexdigest()}
    after=counts(app);record['attempts'].append({'exit':p.returncode,'seconds':round(time.monotonic()-started,3),'report':report,'before':before,'after':after,'growth':{k:after[k]-before[k] for k in before},'stderrSha256':hashlib.sha256(p.stderr).hexdigest()})
   return record
  with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
   pending={pool.submit(work,n):n for n in sorted(set(os.environ.get('DX10_REPLAY_LANES','').split(',') if os.environ.get('DX10_REPLAY_LANES') else PROCESS+POLLUTION))}
   for future in concurrent.futures.as_completed(pending):
    n=pending[future]
    try:r=future.result()
    except Exception as error:r={'lane':n,'errorType':type(error).__name__} # no potentially sensitive exception text
    results.append(r);OUT.write_text(json.dumps({**metadata,'processLanes':PROCESS,'pollutionLanes':POLLUTION,'results':sorted(results,key=lambda r:r['lane'])},indent=2)+'\n');print(n,'done',flush=True)
 finally:
  shutil.rmtree(SCRATCH)
  value=json.loads(OUT.read_text());value['scratchRemoved']=not SCRATCH.exists();OUT.write_text(json.dumps(value,indent=2)+'\n')
if __name__=='__main__':main()
