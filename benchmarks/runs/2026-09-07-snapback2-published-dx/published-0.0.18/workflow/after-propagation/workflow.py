from pathlib import Path
import importlib.util,json,os,sys,time,tarfile,hashlib,shutil
ROOT=Path(__file__).resolve().parent
HELPER=Path('/Users/ccheever/clique-improvement/revisions/default-install-timeout-race-repair-r3/candidate-helper.py')
assert hashlib.sha256(HELPER.read_bytes()).hexdigest()=='b66c1e0e7eddb99d6a17a3902a0d3fb116f35618c47068d16b8d97a87438fa0a'
spec=importlib.util.spec_from_file_location('accepted_timeout',HELPER);h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
# Reuse the accepted execute implementation unchanged. Only installed()'s version binding changes.
h.VERSION='0.0.18'
NODE=h.NODE;NPM=h.NPM
state=ROOT/'npm-state'
env={'HOME':str(Path.home()),'PATH':str(Path(NODE).parent)+':/usr/bin:/bin:/usr/sbin:/sbin','LANG':'en_US.UTF-8','npm_config_cache':'/Users/ccheever/bench-snapback2-dx/published-0.0.18/npm-state/cache','npm_config_userconfig':str(state/'user.npmrc'),'npm_config_globalconfig':str(state/'global.npmrc'),'npm_config_update_notifier':'false'}
checks=[]
def execute(label,args,cwd):
 print(json.dumps({'starting':label,'load':os.getloadavg()}),flush=True)
 h.execute(ROOT,label,args,cwd,env,checks)
 print(json.dumps({'completed':label,'seconds':checks[-1]['elapsedSeconds'],'actualReturnCode':checks[-1]['actualReturnCode']}),flush=True)
def cli(label,args,cwd):execute(label,[NODE,str(ROOT/'consumer/node_modules/snapback2/bin/snapback2.mjs'),*args],cwd)
if __name__=='__main__':
 phase=sys.argv[1]
 report={'phase':phase,'version':'0.0.18','helperSha256':h.digest(HELPER),'checks':checks,'ok':False,'startEpoch':time.time(),'initialLoad':os.getloadavg(),'timeoutSeconds':30,'automaticRetry':False}
 try:
  if phase=='install':
   public=json.loads((ROOT/'public-pair.json').read_text());assert public['matched']
   state.mkdir();(state/'user.npmrc').write_text('');(state/'global.npmrc').write_text('')
   execute('node-version',[NODE,'--version'],ROOT);execute('npm-version',[NODE,NPM,'--version'],ROOT)
   assert (ROOT/'receipts/node-version.log').read_text().strip()=='v24.18.0'
   assert (ROOT/'receipts/npm-version.log').read_text().strip()=='11.16.0'
   artifacts=Path('/Users/ccheever/projects/snapback-artifacts/clique-release/0.0.18-7b947aa4d')
   resume=json.loads((artifacts/'resume-ready.json').read_text());b={'artifacts':{a['name']:a for a in resume['artifacts']}};packed={}
   for a in resume['artifacts']:
    with tarfile.open(a['tarball']) as tf:packed[a['name']]={m.name.removeprefix('package/'):tf.extractfile(m).read() for m in tf if m.isfile()}
   producer=ROOT/'producer';consumer=ROOT/'consumer';producer.mkdir();h.write_json(producer/'package.json',{'name':'snapback2-public-018-witness','private':True,'type':'module'})
   execute('default-install',[NODE,NPM,'install',*h.FLAGS,'--save-exact','snapback2@0.0.18','react@19.1.1'],producer)
   first=h.installed(producer,b,packed);h.write_json(ROOT/'producer-installed.json',first)
   consumer.mkdir()
   for name in ['package.json','package-lock.json']:shutil.copyfile(producer/name,consumer/name)
   assert not (consumer/'node_modules').exists()
   execute('fresh-ci',[NODE,NPM,'ci',*h.FLAGS],consumer)
   second=h.installed(consumer,b,packed);h.write_json(ROOT/'consumer-installed.json',second);assert first==second
   report.update(installedPairEqual=True,regularFiles=first['totalRegularFileCount'],cachePolicy='Initial empty private cache; fresh ci reuses this populated cache with no node_modules',noWorkspaceLinks=True)
  elif phase=='start':
   consumer=ROOT/'consumer';project=consumer/'todos';project.mkdir()
   cli('doctor',['doctor','--json'],consumer)
   cli('init',['init','.','--template','todos','--client','none','--json'],project)
   cli('guide',['guide'],project)
   cli('check-initial',['check','--json'],project)
   cli('dev-start',['dev'],project)
   cli('first-run',['run','todos.list','--as','alice','--json'],project)
  elif phase=='timeout-control':
   try:execute('intentional-timeout',[NODE,'-e','setTimeout(() => {}, 60000)'],ROOT)
   except RuntimeError:
    r=checks[-1];assert r['exitCode']==124 and r['timedOut'] is True and r['actualReturnCode']==-9 and r['actualProcessWaitCompleted'] is True and not r.get('cleanupUnknown') and not r.get('cleanupFailure')
    report['expectedTimeoutObserved']=True
   else:raise AssertionError('Timeout control unexpectedly passed')
  else:raise ValueError(phase)
  report['ok']=True
 except BaseException as exc:
  report['failure']={'type':type(exc).__name__,'message':str(exc)};raise
 finally:
  report['endEpoch']=time.time();report['endLoad']=os.getloadavg();h.write_json(ROOT/(phase+'-report.json'),report)
