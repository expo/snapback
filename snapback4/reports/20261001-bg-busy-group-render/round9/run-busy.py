from pathlib import Path
import subprocess, os, json, hashlib, time
root=Path(__file__).resolve().parents[3]
out=Path(__file__).resolve().parent
tools=root/'reports/20261001-bg-busy-group-render/tools'
env={**os.environ,'LIBSQLITE3_FLAGS':'-USQLITE_ENABLE_MEMORY_MANAGEMENT'}
seed=f'/tmp/bg-round9-seed-{os.getpid()}'
source={p:hashlib.sha256(p.read_bytes()).hexdigest() for p in [root/'crates/snapback4-core/src/engine/runner.rs',root/'crates/snapback4-core/src/engine/mod.rs',root/'crates/snapback4-core/src/partition/counts.rs']}
results=[]
def run(name,cmd,extra={}):
    assert not (out/(name+'.exit')).exists(), name+' must run once'
    print('START',name,flush=True);start=time.time()
    with (out/(name+'.log')).open('w') as log:
        r=subprocess.run(cmd,cwd=root,env={**env,**extra},stdout=log,stderr=subprocess.STDOUT)
    (out/(name+'.exit')).write_text(str(r.returncode)+'\n')
    results.append({'name':name,'command':cmd,'exit':r.returncode,'seconds':time.time()-start})
    (out/'busy-commands.json').write_text(json.dumps(results,indent=2)+'\n')
    print('END',name,r.returncode,flush=True)
    return r.returncode
try:
    assert run('instrument-server',['python3',str(tools/'instrument-server.py')],{'BG_PROFILE':'production'})==0
    assert all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in source.items())
    binary=root/'target/debug/snapback4-ll-measure'
    (out/'busy-binary.json').write_text(json.dumps({'profile':'production','sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'source_restored':True},indent=2)+'\n')
    assert run('instrument-client',['python3',str(tools/'instrument-client.py')])==0
    for condition in ['idle','loaded']:
        name='busy-'+condition
        args=['python3',str(tools/'host-load.py')]
        if condition=='loaded':args+=['python3',str(tools/'contended.py')]
        args+=['node',str(tools/'measure.mjs')]
        settings={'BG_PROFILE':'production','BG_RUNS':'50','BG_SEED_CACHE':seed,'BG_OUT':str(out/(name+'.json')),'SNAPBACK4_BIN':str(binary)}
        if condition=='idle':settings['BG_MAX_P95']='250'
        run(name,args,settings)
        if (out/(name+'.json')).exists():run(name+'-summary',['node',str(tools/'summarize.mjs'),str(out/(name+'.json'))])
finally:
    run('client-restored',['bun','run','--cwd','packages/snapback4','build'])
    assert all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in source.items())
    for suffix in ['.sqlite','.json']:
        Path(seed+suffix).unlink(missing_ok=True)
