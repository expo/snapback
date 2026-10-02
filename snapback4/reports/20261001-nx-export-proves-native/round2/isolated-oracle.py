from pathlib import Path
import os,subprocess,json,time
root=Path(__file__).resolve().parents[3];report=Path(__file__).resolve().parent
while json.loads((report/'workflow-state.json').read_text())['phase']!='complete':time.sleep(3)
node='/Users/ccheever/.volta/tools/image/node/24.18.0/bin/node';env=dict(os.environ);env['PATH']=str(Path(node).parent)+':'+env['PATH']
command=[node,'--test','--test-name-pattern=mixed evidence schedule wasm','packages/snapback4/test/mixed-evidence-oracle.test.mjs'];start=time.time()
with (report/'oracle-isolated.log').open('x') as log:
 child=subprocess.Popen(command,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
 (report/'oracle-isolated-process.json').write_text(json.dumps({'pid':child.pid,'startedAt':start,'command':command,'seeds':300})+'\n')
 try:status=child.wait(timeout=1860);forced=False
 except subprocess.TimeoutExpired:
  # This gives the unchanged 1800-second case guard another minute to clean up.
  child.terminate();status=child.wait(timeout=15);forced=True
(report/'oracle-isolated-status.json').write_text(json.dumps({'exitStatus':status,'durationSeconds':time.time()-start,'forcedAfterGuard':forced,'seeds':300},indent=2)+'\n')
