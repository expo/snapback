"""Check the retained final cohorts and record their exact scope after audit repair."""
from pathlib import Path
import hashlib,json,re,subprocess
report=Path(__file__).resolve().parent
root=report.parents[1]
raw=report/'raw'
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def read(name):return json.loads((raw/name).read_text())
def summary(path,expected):
 s=path.read_text()
 for label,value in expected.items():
  assert re.search(rf'^(?:#|ℹ) {label} {value}$',s,re.M),(path,label,value)
 return {'path':str(path.relative_to(report)),'sha256':digest(path),**expected}
audit={'packages/snapback4/test/delivery-await-boundary.json','packages/snapback4/test/delivery-fault-instrument.mjs'}
result={'base':json.loads((report/'environment.json').read_text())['head'],'cohorts':{}}
for name in ['unconfined-final-50','loaded-final-50']:
 d=read(name+'.json')
 assert d['pass'] and d['changedInputs']==[] and len(d['runs'])==50
 assert [r['run'] for r in d['runs']]==list(range(1,51)) and all(r['exit']==0 for r in d['runs'])
 logs=[summary(raw/f'{name}-{n:02}.log',{'tests':7,'pass':7,'fail':0,'cancelled':0,'skipped':0}) for n in range(1,51)]
 inputs=read(name+'-inputs.json')
 changed={p for p,h in inputs.items() if digest(root/p)!=h}
 assert changed==audit,(name,changed)
 result['cohorts'][name]={'runs':50,'passes':350,'failures':0,'logs':logs,
  'receipt_sha256':digest(raw/(name+'.json')),'input_inventory_sha256':digest(raw/(name+'-inputs.json')),
  'after_cohort_changes':sorted(changed),'scope':'Audit manifest hash and classification comment only; runtime, built SDK, wasm and all executed browser tests unchanged.'}
load=json.loads((report/'loaded-final-50.json').read_text())
assert load['exit']==0 and not load.get('source_changed_during_run') and not load.get('harness_failure')
assert load['workers']==48 and len(load['load_completion'])==48
assert all(x['alive_before_stop'] and x['cpu_seconds']>0 for x in load['load_completion'])
assert all(mask==list(range(86,96)) for mask in load['load_affinity'].values())
result['load']={'metadata_sha256':digest(report/'loaded-final-50.json'),'workers':48,'cpus':list(range(86,96)),
 'all_workers_survived':True,'elapsed_seconds':load['elapsed_seconds'],
 'cpu_seconds':sum(x['cpu_seconds'] for x in load['load_completion'])}
result['affected']=summary(raw/'affected-hardened.log',{'tests':1202,'pass':1202,'fail':0,'cancelled':0,'skipped':0})
result['delivery_matrix']=summary(raw/'delivery-matrix-final.log',{'tests':321,'pass':321,'fail':0,'cancelled':0,'skipped':0})
s=(raw/'full-suite-01.log').read_text();assert s.rstrip().endswith('== 0 failure(s) in 1385 s')
result['full_suite']={'summary':'== 0 failure(s) in 1385 s','log_sha256':digest(raw/'full-suite-01.log'),
 'scope':'Single complete run before final callback-boundary hardening; final client/model stages repeated separately.'}
s=(raw/'final-clients-01.log').read_text()
assert 'ℹ tests 5745\n' in s and 'ℹ pass 5734\n' in s and 'ℹ fail 1\n' in s and 'ℹ skipped 10\n' in s
assert 'ℹ tests 79\n' in s and 'ℹ pass 79\n' in s and s.rstrip().endswith('== client models: exit 0')
failures={re.sub(r' \([0-9.]+ms\)$','',m) for m in re.findall(r'^✖ (.+)$',s,re.M)}-{'failing tests:'}
assert failures=={'every delivery await is explicitly classified'},failures
assert read('final-clients.json')['changedInputs']==[]
result['final_clients']={'log_sha256':digest(raw/'final-clients-01.log'),'pool':{'tests':5745,'passed':5734,'failed':1,'skipped':10},
 'models':{'tests':79,'passed':79,'failed':0},'failure':'Ours: reviewed await census hash; final full delivery matrix passes after repair.'}
wasm=root/'packages/snapback4/src/wasm/snapback4_device_bg.wasm'
compressed=subprocess.check_output(['gzip','-9','-c',str(wasm)])
assert wasm.stat().st_size==1994357 and len(compressed)==598401
result['wasm']={'raw':wasm.stat().st_size,'gzip':len(compressed),'sha256':digest(wasm),'budget':599000}
result['final_audit_files']={p:digest(root/p) for p in sorted(audit)}
(report/'qualification.json').write_text(json.dumps(result,indent=2)+'\n')
print('Qualification checked: 50+50 whole-file passes, fixed runtime inputs, 48 surviving workers, final audit repaired.')
