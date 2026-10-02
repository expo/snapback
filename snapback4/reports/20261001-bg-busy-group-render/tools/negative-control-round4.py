"""Detect the round-3 failures, then the isolated flag-certification mutation.
No other build may consume this workspace during the temporary substitutions.
"""
from pathlib import Path
import os, subprocess, json
root=Path(__file__).resolve().parents[3]
report=root/'reports/20261001-bg-busy-group-render/round4'
paths=['crates/snapback4-core/src/engine/'+p for p in ['row_views.rs','witness.rs','validate.rs']]
paths+=['crates/snapback4-core/src/store/activation.rs','crates/snapback4-core/src/maintain/row_key.rs']
saved={root/p:(root/p).read_bytes() for p in paths}
env={**os.environ,'LIBSQLITE3_FLAGS':'-USQLITE_ENABLE_MEMORY_MANAGEMENT'}
results=[]
def run(name,args,expected):
    with (report/(name+'.log')).open('w') as log:
        p=subprocess.run(['cargo','test',*args,'--','--nocapture'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
    text=(report/(name+'.log')).read_text()
    (report/(name+'.exit')).write_text(str(p.returncode)+'\n')
    assert p.returncode==101 and expected in text and 'error[E' not in text, name
    results.append({'name':name,'exit':p.returncode,'expected':expected})
try:
    for p in saved:
        p.write_bytes(subprocess.check_output(['git','show','587b83d7c8:snapback4/'+str(p.relative_to(root))],cwd=root))
    run('round3-rule-negative',['-p','snapback4-core','--lib','private_settlement_cannot_change_read_or_insert_rules'],'test result: FAILED. 0 passed; 1 failed;')
    run('round3-device-negative',['-p','snapback4-device','--test','row_view_expiry','durable_source_rule_budget'],'test result: FAILED. 0 passed; 2 failed;')
    for p,data in saved.items(): p.write_bytes(data)
    witness=root/'crates/snapback4-core/src/engine/witness.rs'
    witness.write_bytes(subprocess.check_output(['git','show','587b83d7c8:snapback4/crates/snapback4-core/src/engine/witness.rs'],cwd=root))
    run('flag-certification-negative',['-p','snapback4-core','--lib','every_field_rule_certifies_absent_and_legacy_pending_cache'],'test result: FAILED. 0 passed; 1 failed;')
finally:
    for p,data in saved.items(): p.write_bytes(data)
(report/'negative-controls.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
