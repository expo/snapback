"""Check retained evidence against final source and publish only measured facts."""
from pathlib import Path
import hashlib,json,re
from check_initial import check_initial
from check_followup import check_followup
report=Path(__file__).resolve().parent;root=report.parents[1]
final=json.loads((report/'source-manifest-repaired.json').read_text())
assert all(hashlib.sha256((root/p).read_bytes()).hexdigest()==digest for p,digest in final.items())
initial_records={row["name"]:row for row in check_initial(report)}
followup_records={row["name"]:row for row in check_followup(report)}
late=set(json.loads((report/'late-files.json').read_text()))
records=[]
def collect(name,loaded,phase):
 final_source=phase=='final'
 prior=initial_records[name] if phase=='initial' else followup_records[name] if phase=='followup' else None
 meta=json.loads((report/(name+'.json')).read_text());log=(report/(name+'.log')).read_text()
 assert meta['exit']==(0 if final_source else prior['exit']),(name,meta['exit'])
 assert meta['source_manifest']==meta['source_manifest_after'],name
 difference={p for p in final if final[p]!=meta['source_manifest'][p]}
 expected_difference=set() if final_source else late if phase=='initial' else {'packages/snapback4/test/client-seams.test.mjs','packages/snapback4/test/ordinary-search-oracle.test.mjs'}
 assert difference==expected_difference,(name,difference)
 if final_source:assert not re.search(r'^\s*✖',log,re.M),name
 counts={key:[int(n) for n in re.findall(r'^ℹ '+key+r' (\d+)$',log,re.M)] for key in ['tests','pass','fail','cancelled','skipped']}
 expected_cancelled=[0,1] if phase=='initial' else prior['cancelled_counts'] if phase=='followup' else [0]*len(counts['cancelled'])
 expected_failed=[len(prior['superseded_failures']),0] if phase=='initial' else prior['fail_counts'] if phase=='followup' else [0]*len(counts['fail'])
 assert counts['tests'] and counts['cancelled']==expected_cancelled and counts['fail']==expected_failed,name
 assert all(v is None for v in meta['test_overrides'].values()),name
 if loaded:
  assert meta['workers']==48 and len(meta['load_completion'])==48,name
  assert all(p['alive_before_stop'] and p['cpu_seconds']>0 for p in meta['load_completion']),name
  assert all(len(mask)==10 for mask in meta['load_affinity'].values()),name
 else:assert meta['workers']==0 and not meta['affinity'] and not meta['guard'],name
 records.append(dict(name=name,phase=phase,seconds=meta['elapsed_seconds'],counts=counts,source_difference=sorted(difference),superseded_failures=[] if final_source else prior['superseded_failures'],log_sha256=hashlib.sha256(log.encode()).hexdigest(),metadata_sha256=hashlib.sha256((report/(name+'.json')).read_bytes()).hexdigest()))
for n in range(1,6):collect(f'heavy-{n}',True,'initial')
for n in range(1,6):
 name=f'heavy-{n}-final';collect(name,True,'followup')
 log=(report/(name+'.log')).read_text()
 for tier in ['online','local']:assert f'{tier} session state machine preserves I1–I13 across 5,000 seeded three-runtime sequences' in log
for n in range(1,6):collect(f'heavy-{n}-repair',True,'final')
collect('final-unconfined',False,'final')
collect('whole-suite',False,'final')
whole=(report/'whole-suite.log').read_text();footers=re.findall(r'^== \d+ failure\(s\) in \d+ s$',whole,re.M)
assert len(footers)==1 and footers[0].startswith('== 0 failure(s)'),footers
assert not re.search(r'^-- FAIL:',whole,re.M)
guide=(report/'guide.log').read_text();assert '110 passed; 0 failed; 0 ignored' in guide
controls=json.loads((report/'controls.json').read_text());assert len(controls)==2 and all(x['expected']for x in controls)
for control in controls:
 assert control['test_sha256']==final['packages/snapback4/test/live-propagation-fallback.test.mjs']
 assert control['wait_sha256']==final['packages/snapback4/test/helpers/wait.mjs']
 assert control['original']==hashlib.sha256((root/'packages/snapback4/dist/local.js').read_bytes()).hexdigest()
 assert control['mutant']!=control['original']
 assert 'WB_MUTATION' in (report/(control['name']+'.log')).read_text()
assert controls[0]['exit']==0 and controls[0]['seconds']>=15 and controls[1]['exit']==1
assert 'TEST_HANG: new branch obtains a current whole-server answer while sync remains held' in (report/'missing-publication.log').read_text()
changes=[line for line in __import__('subprocess').check_output(['git','diff',json.loads((report/'environment.json').read_text())['head'],'--name-only'],cwd=root,text=True).splitlines()]
assert all(p.startswith(('snapback4/packages/snapback4/test/','snapback4/reports/')) or p in ['snapback4/witness/lib.mjs','snapback4/JOURNAL.md'] for p in changes),changes
output=dict(qualified=True,contention_scope='Five source-bound composite repetitions: unchanged passing files, reruns of every scope in late-tests.json, and five final full-file client-seams/search repairs. All diagnosed superseded failures and intentional model cancellations are retained.',whole_suite_footer=footers[0],runs=records,source_manifest_sha256=hashlib.sha256((report/'source-manifest-repaired.json').read_bytes()).hexdigest(),guide='110 passed; 0 failed; 0 ignored',controls=controls,final_failures=dict(ours=0,baseline=0,environmental=0))
(report/'qualification.json').write_text(json.dumps(output,indent=2)+'\n');print(footers[0]);print('all final scopes qualify')
