from pathlib import Path
import os, subprocess, shutil, json, hashlib, time, platform
root=Path(__file__).resolve().parents[3]
report=root/'reports/20261001-bg-busy-group-render/round3'
tools=root/'reports/20261001-bg-busy-group-render/tools'
env={**os.environ,'LIBSQLITE3_FLAGS':'-USQLITE_ENABLE_MEMORY_MANAGEMENT'}
def run(name,args,extra=None):
    print('START',name,flush=True)
    (report/'progress.json').write_text(json.dumps({'phase':name,'started':time.time()})+'\n')
    with (report/(name+'.log')).open('w') as log:
        result=subprocess.run(args,cwd=root,env={**env,**(extra or {})},stdout=log,stderr=subprocess.STDOUT)
    (report/(name+'.exit')).write_text(str(result.returncode)+'\n')
    print('END',name,result.returncode,flush=True)
    return result.returncode
assert run('affected-final',['cargo','test','-p','snapback4-core','--lib','engine::row_views::','--','--nocapture'])==0
assert run('guide-compat',['cargo','test','-p','snapback4-lang','--test','guide','--test','ephemeral_compat'])==0
assert run('wasm',['bash','scripts/build-wasm.sh'])==0
wasm=root/'packages/snapback4/src/wasm/snapback4_device_bg.wasm'
wasm_info={'raw_bytes':wasm.stat().st_size,'gzip_bytes':len(subprocess.check_output(['gzip','-9','-c',str(wasm)])), 'sha256':hashlib.sha256(wasm.read_bytes()).hexdigest(),'branch_ratchet':605225,'current_main_ratchet':610782,'gzip_method':'gzip -9 -c FILE'}
(report/'wasm.json').write_text(json.dumps(wasm_info,indent=2)+'\n')
assert run('client-build',['bun','run','--cwd','packages/snapback4','build'])==0
assert run('instrument-client',['python3',str(tools/'instrument-client.py')])==0
for profile in ['dev','production']:
    assert run('instrument-'+profile,['python3',str(tools/'instrument-server.py')],{'BG_PROFILE':profile})==0
    shutil.copy2(root/'target/debug/snapback4-ll-measure', '/tmp/bg-round3-'+profile)
artifacts={name:hashlib.sha256(Path('/tmp/bg-round3-'+name).read_bytes()).hexdigest() for name in ['dev','production']}
(report/'binaries.json').write_text(json.dumps(artifacts,indent=2)+'\n')
for condition in ['idle','loaded']:
    name='qualification-'+condition
    args=['python3',str(tools/'host-load.py')]
    if condition=='loaded': args+=['python3',str(tools/'contended.py')]
    args+=['node',str(tools/'measure.mjs')]
    settings={'BG_PROFILE':'production','BG_RUNS':'50','BG_SEED_CACHE':'/tmp/bg-round3-seed','BG_OUT':str(report/(name+'.json')),'SNAPBACK4_BIN':'/tmp/bg-round3-production'}
    if condition=='idle': settings['BG_MAX_P95']='250'
    assert run(name,args,settings)==0
    assert run(name+'-summary',['node',str(tools/'summarize.mjs'),str(report/(name+'.json'))])==0
    assert run(name+'-client',['node',str(tools/'attribute-client.mjs'),str(report/(name+'.json'))])==0
assert run('ll-final',['node','reports/20260929-ll-live-latency/tools/measure.mjs'],{'LL_KEEP':'viewed','LL_TIER':'wasm','LL_RUNS':'20','LL_OUT':str(report/'ll-final.json'),'SNAPBACK4_BIN':'/tmp/bg-round3-dev'})==0
assert run('ll-final-summary',['node','reports/20260929-ll-live-latency/tools/summarize.mjs',str(report/'ll-final.json')])==0
assert run('qualification-validator',['python3',str(tools/'qualify-round1.py')],{'BG_ROUND':'round3'})==0
assert run('client-restore',['bun','run','--cwd','packages/snapback4','build'])==0
code=run('full-suite',['bash','scripts/test.sh'])
assert hashlib.sha256(wasm.read_bytes()).hexdigest()==wasm_info['sha256'],'suite wasm differs'
(report/'progress.json').write_text(json.dumps({'phase':'done','full_suite_exit':code})+'\n')
print('DONE full-suite exit',code,flush=True)
