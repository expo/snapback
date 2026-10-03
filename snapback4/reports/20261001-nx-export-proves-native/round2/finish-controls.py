from pathlib import Path
import os,subprocess,time,json
root=Path(__file__).resolve().parents[3];report=Path(__file__).resolve().parent
node='/Users/ccheever/.volta/tools/image/node/24.18.0/bin/node'
env=dict(os.environ);env['PATH']=str(Path(node).parent)+':'+env['PATH'];env['NX_BIN']=str(root/'target/nx/final-cli')
def state(phase):
    (report/'workflow-state.json').write_text(json.dumps({'pid':os.getpid(),'phase':phase,'at':time.time()})+'\n')
def run(script,args=(),extra=None):
    with (report/(script.removesuffix('.mjs')+'-final.log')).open('x') as log:
        result=subprocess.run([node,str(report/script),*args],cwd=root,env={**env,**(extra or {})},stdout=log,stderr=subprocess.STDOUT)
    if result.returncode:state('FAILED '+script);raise SystemExit(result.returncode)
state('waiting for installed plugin controls')
while not (report/'social-plugin-controls.json').exists():time.sleep(3)
state('social dependency guard control');run('dependency-control.mjs',['social'])
state('social SIGKILL recovery controls');run('recovery-controls.mjs',['social'],{'NX_SMOKE_DEVICE_PREFIX':'sb4-nx-recovery-r2-'})
state('waiting for the one full suite to drain')
while not (report/'full-suite-status.json').exists():time.sleep(3)
state('serial final cold and warm cohort');run('cohort.mjs')
state('isolated effective-config cost');run('effective-cost.mjs')
state('startup throw, FILE/File URLs, missing runtime and opt-out');run('negative-controls.mjs')
state('complete')
