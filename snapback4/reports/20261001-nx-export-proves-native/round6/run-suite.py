from pathlib import Path
import os,subprocess,time,json
root=Path(__file__).resolve().parents[3];report=Path(__file__).resolve().parent
env=dict(os.environ);env['PATH']='/Users/ccheever/.volta/tools/image/node/24.18.0/bin:'+env['PATH'];env['LIBSQLITE3_FLAGS']='-USQLITE_ENABLE_MEMORY_MANAGEMENT'
assert not (report/'full-suite-status.json').exists()
started=time.time()
with (report/'full-suite.log').open('x') as log:
    child=subprocess.Popen(['caffeinate','-i','bash','scripts/test.sh'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
    (report/'full-suite-process.json').write_text(json.dumps(dict(supervisorPid=os.getpid(),suiteSupervisorPid=child.pid,startedAt=started)))
    status=child.wait()
(report/'full-suite-status.json').write_text(json.dumps(dict(exitStatus=status,durationSeconds=time.time()-started,invocations=1),indent=2)+'\n')
