"""Isolated detecting rollbacks; always restore the candidate production file."""
from pathlib import Path
import subprocess, os, json, hashlib
root=Path(__file__).resolve().parents[3]
repo=root.parent
report=root/'reports/20261001-bg-busy-group-render/round5'
env={**os.environ,'LIBSQLITE3_FLAGS':'-USQLITE_ENABLE_MEMORY_MANAGEMENT'}
results={}
for name,rel,args,needle in [
    ('round4-deadline-negative','crates/snapback4-core/src/engine/witness.rs',
     ['cargo','test','-p','snapback4-core','--test','row_view_witness','permit_deadline_refuses','--','--nocapture'],
     'left: None'),
    ('round4-metadata-negative','crates/snapback4-core/src/engine/row_views.rs',
     ['cargo','test','-p','snapback4-device','--test','row_view_expiry','durable_source_rule_budget','--','--nocapture'],
     'prediction metadata'),
]:
    path=root/rel;candidate=path.read_bytes()
    old=subprocess.check_output(['git','show','0da1777252:snapback4/'+rel],cwd=repo)
    try:
        path.write_bytes(old)
        with (report/(name+'.log')).open('w') as log:
            result=subprocess.run(args,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
        (report/(name+'.exit')).write_text(str(result.returncode)+'\n')
        log=(report/(name+'.log')).read_text()
        results[name]={'exit':result.returncode,'assertion_detected':needle in log,'source':'0da1777252','file':rel}
        assert result.returncode!=0 and needle in log,(name,log[-3000:])
    finally: path.write_bytes(candidate)
path=root/'packages/snapback4/src/wasm/snapback4_device_bg.wasm'
artifact=root/'target/bg-round4-artifacts/candidate-dist/wasm/snapback4_device_bg.wasm'
candidate=path.read_bytes();old=artifact.read_bytes()
digest=hashlib.sha256(old).hexdigest()
assert digest=='a4a4014a1b221e39fbc8bf8d384f64065271f57ccbdfc8e7c45532ca489f1b30'
name='round4-web-metadata-negative'
try:
    path.write_bytes(old)
    with (report/(name+'.log')).open('w') as log:
        result=subprocess.run(['node','--test','packages/snapback4/test/row-view-prediction.test.mjs'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
    (report/(name+'.exit')).write_text(str(result.returncode)+'\n')
    detected='prediction metadata on reconstructed wasm row' in (report/(name+'.log')).read_text()
    results[name]={'exit':result.returncode,'assertion_detected':detected,'source':'0da1777252','artifact':str(artifact.relative_to(root)),'sha256':digest}
    assert result.returncode!=0 and detected
finally: path.write_bytes(candidate)
(report/'negative-controls.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
