"""Paired round-2/round-5 BG and LL, using separately built saved artifacts.
Run only after builds/affected tests finish. No source edits or builds here.
"""
from pathlib import Path
import os, sys, subprocess, shutil, json, time, hashlib, math
root=Path(__file__).resolve().parents[3]
report=root/'reports/20261001-bg-busy-group-render/round5'
tools=Path(__file__).resolve().parent
artifacts=root/'target/bg-round5-artifacts'
env={**os.environ,'LIBSQLITE3_FLAGS':'-USQLITE_ENABLE_MEMORY_MANAGEMENT'}
def run(name,args,extra=None):
    print('START',name,flush=True)
    (report/'progress.json').write_text(json.dumps({'phase':name,'at':time.time()})+'\n')
    with (report/(name+'.log')).open('w') as log:
        p=subprocess.run(args,cwd=root,env={**env,**(extra or {})},stdout=log,stderr=subprocess.STDOUT)
    (report/(name+'.exit')).write_text(str(p.returncode)+'\n')
    print('END',name,p.returncode,flush=True)
    return p.returncode

def quiet(label):
    def cpu():
        a=[int(x) for x in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
        return sum(a),a[3]+a[4]
    previous=cpu();consecutive=0
    with (report/(label+'-admission.jsonl')).open('a') as out:
        while consecutive<5:
            time.sleep(2);current=cpu()
            busy=100*(1-(current[1]-previous[1])/(current[0]-previous[0]));previous=current
            consecutive=consecutive+1 if busy<15 else 0
            out.write(json.dumps({'at':time.time(),'busy_percent':busy,'consecutive':consecutive})+'\n');out.flush()


def install(variant):
    dist=root/'packages/snapback4/dist'
    shutil.rmtree(dist)
    shutil.copytree(artifacts/(variant+'-dist'),dist)


def batch(condition):
    for n,variant in enumerate(['base','candidate','base','candidate']):
        name=f'{condition}-{n+1}-{variant}'
        if condition=='idle':quiet(name)
        install(variant)
        settings={'BG_PROFILE':'production','BG_RUNS':'50','BG_SEED_CACHE':'/tmp/bg-round3-seed',
            'BG_OUT':str(report/(name+'.json')),'SNAPBACK4_BIN':str(artifacts/(variant+'-production'))}
        if condition=='idle':settings['BG_MAX_P95']='250'
        run(name,['python3',str(tools/'host-load.py'),'node',str(tools/'measure.mjs')],settings)
        for tool in ['summarize','attribute-client']:
            assert run(name+'-'+tool,['node',str(tools/(tool+'.mjs')),str(report/(name+'.json'))])==0

if len(sys.argv)>1:
    batch(sys.argv[1]);sys.exit(0)

hashes={}
for variant in ['base','candidate']:
    files=[artifacts/(variant+'-'+profile) for profile in ['dev','production']]
    files += sorted((artifacts/(variant+'-dist')).rglob('*'))
    hashes[variant]={str(p.relative_to(artifacts)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.is_file()}
(report/'measurement-artifacts.json').write_text(json.dumps(hashes,indent=2)+'\n')
batch('idle')
quiet('loaded')
assert run('loaded-batch',['python3',str(tools/'contended.py'),'python3',str(Path(__file__).resolve()),'loaded'])==0
for variant in ['base','candidate']:
    quiet('ll-'+variant)
    install(variant)
    assert run('ll-'+variant,['python3',str(tools/'host-load.py'),'node','reports/20260929-ll-live-latency/tools/measure.mjs'],
        {'LL_KEEP':'viewed','LL_TIER':'wasm','LL_RUNS':'20','LL_OUT':str(report/('ll-'+variant+'.json')),
         'SNAPBACK4_BIN':str(artifacts/(variant+'-dev'))})==0
    assert run('ll-'+variant+'-summary',['node','reports/20260929-ll-live-latency/tools/summarize.mjs',str(report/('ll-'+variant+'.json'))])==0
(report/'progress.json').write_text(json.dumps({'phase':'measured'})+'\n')
