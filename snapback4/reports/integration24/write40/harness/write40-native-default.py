from pathlib import Path
import subprocess,json,time,os,hashlib,shutil,re
b=Path('/home/ccheever/sb4-loop/integ24');root=Path('/home/ccheever/projects/snapback-sb4loop');sb=root/'snapback4';out=b/'write40-native';out.mkdir(exist_ok=True)
while not(b/'pg-wave26-write40-wrapper.exit').exists():time.sleep(3)
assert(b/'pg-wave26-write40-wrapper.exit').read_text().strip()=='0'
source=json.loads((b/'write40-source.json').read_text())['source'];assert subprocess.check_output(['timeout','15s','git','rev-parse','HEAD'],cwd=root,text=True).strip()==source
assert not subprocess.check_output(['timeout','15s','git','status','--porcelain'],cwd=root,text=True)
env=dict(os.environ,PATH='/home/ccheever/.bun-1.4.2/bin:'+os.environ['PATH'],CARGO_INCREMENTAL='0',CARGO_PROFILE_DEV_DEBUG='0',CARGO_PROFILE_TEST_DEBUG='0',CARGO_BUILD_JOBS='4',CARGO_TARGET_DIR=str(sb/'target'));commands=[]
def run(key,args,budget=2400):
 with(out/(key+'.log')).open('w')as log:r=subprocess.run(['timeout',str(budget)+'s',*map(str,args)],cwd=sb,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=budget+20)
 commands.append({'key':key,'argv':list(map(str,args)),'exit':r.returncode});(out/'commands.json').write_text(json.dumps(commands,indent=2)+'\n');print(key,r.returncode,flush=True);assert r.returncode==0
run('default-native-build',['cargo','build','--locked','-p','snapback4'])
binary=sb/'target/debug/snapback4';frozen=b/'bin/snapback4-write40-default';shutil.copy2(binary,frozen)
version=subprocess.check_output(['timeout','15s',str(frozen),'--version'],text=True);assert'0.4.40'in version
run('prepare-client',['node','scripts/publish.mjs','--prepare-client','--prepare-directory',str(b/'pack-write40-default')],3600)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();packs={p.name:sha(p)for p in(b/'pack-write40-default').glob('*.tgz')};expected={'snapback4-0.4.40.tgz':'45ef5fded9e88330086f10181dc4f35bf605c214ba0e0664a6dfe2714f556961','snapback4-expo-0.4.40.tgz':'0b431967a27670d63ccb94e537e4a9e596c3079f03480a72b7c2ce62b6c4da69'};assert packs==expected,(packs,expected)
(out/'binding.json').write_text(json.dumps({'source':source,'binary':str(frozen),'binarySha256':sha(frozen),'version':version.strip(),'freshPacksSha256':packs,'identicalToCompleteInstalledConsumerQualification':True,'consumerReceipt':'../write40/packed/consumer.json','scope':'The installed consumer qualification applies to these identical artifact bytes; shared native write execution is separately qualified by the full workspace/client suites and private PostgreSQL campaigns.'},indent=2)+'\n')
pg=Path('/home/ccheever/tools/pg16/usr');env['PATH']=str(pg/'lib/postgresql/16/bin')+':'+env['PATH'];env['LD_LIBRARY_PATH']=str(pg/'lib/x86_64-linux-gnu');env['SNAPBACK4_PG_SHARE']=str(pg/'share/postgresql/16');env['SNAPBACK4_POSTGRES_WITNESS_TIMINGS']=str(out/'public-timings.jsonl')
run('public-deploy-serve',['python3','scripts/test-postgres-serve.py'],2400)
text=(out/'public-deploy-serve.log').read_text();matches=re.findall(r'owned cluster stopped and confirmed: status=3, no postmaster.pid; retained (/tmp/s10d3-serve-[A-Za-z0-9_-]+)',text);assert len(matches)==1,text[-2000:];work=Path(matches[0]);assert work.parent==Path('/tmp')and not(work/'data/postmaster.pid').exists()
r=subprocess.run(['timeout','30s','pg_ctl','-D',str(work/'data'),'status'],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True);assert r.returncode==3
records=[json.loads(line)for line in(work/'pids.jsonl').read_text().splitlines()];alive=[]
for record in records:
 try:os.kill(record['pid'],0);alive.append(record)
 except ProcessLookupError:pass
assert not alive,alive
shutil.copy2(work/'pids.jsonl',out/'public-pids.jsonl');shutil.rmtree(work)
(out/'public-cleanup.json').write_text(json.dumps({'statusExit':3,'postmasterPidExists':False,'recordedPids':len(records),'survivingRecordedPids':alive,'ownedDirectoryRemoved':not work.exists()},indent=2)+'\n')
assert sha(binary)==sha(frozen)
status=subprocess.check_output(['timeout','15s','git','status','--porcelain'],cwd=root,text=True);(out/'source-status.txt').write_text(status);assert status==''
(out/'complete.json').write_text(json.dumps({'source':source,'allPassed':True,'freshPackBytesIdentical':True,'publicDefaultNativeQualified':True},indent=2)+'\n');(b/'write40-native.exit').write_text('0\n')
