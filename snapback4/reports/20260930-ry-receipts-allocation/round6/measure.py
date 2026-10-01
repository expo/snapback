"""Run after validation drains; native binaries are built as described in REPORT.md."""
import hashlib,json,os,pathlib,re,statistics,subprocess
root=pathlib.Path(__file__).resolve().parent
repo=root.parents[2]
assert (root/'full-suite.exit').exists(), 'wait for the full suite'
cpu=max(os.sched_getaffinity(0));os.sched_setaffinity(0,{cpu})
samples={};results={};binary_hashes={}
for profile,binary in [('native-count','ry-r6-count'),('native-default','ry-r6-bench')]:
 for run in range(7):
  outputs={}
  for side in (['main','candidate'] if run%2==0 else ['candidate','main']):
   executable=pathlib.Path('/tmp/ry-r6-bench-'+side)/'target/release'/binary
   binary_hashes[profile+'-'+side]=hashlib.sha256(executable.read_bytes()).hexdigest()
   output=subprocess.check_output([str(executable)],text=True)
   with (root/(profile+'-samples.jsonl')).open('a') as f:f.write(json.dumps(dict(run=run,side=side,stdout=output))+'\n')
   if profile=='native-count':
    parsed={f'count-{size}':int(ns) for size,ns in re.findall(r'countLoop size=(\d+) median_ns=(\d+)',output)}
    assert len(parsed)==4
    semantics=re.sub(r'median_ns=\d+', 'median_ns=TIMING', '\n'.join(line for line in output.splitlines() if line.startswith('countLoop')))
   else:
    decoded=[json.loads(line) for line in output.splitlines()];parsed={v['case']:v['median_ns'] for v in decoded if 'case' in v}
    semantics=[{k:v for k,v in item.items() if k not in ['median_ns','p10_ns','p90_ns']} for item in decoded]
   outputs[side]=semantics
   for case,ns in parsed.items():samples.setdefault((profile,case,side),[]).append(ns)
  assert outputs['main']==outputs['candidate'],(profile,run)
for run in range(3):
 output=subprocess.check_output(['node',str(root/'benchmark-wasm.mjs'),'/tmp/ry-r6-main/snapback4',str(repo),str(root/'no-receipts-main.json')],text=True)
 with (root/'wasm-timing-samples.jsonl').open('a') as f:f.write(json.dumps(dict(run=run,stdout=output))+'\n')
 for line in output.splitlines():
  item=json.loads(line)
  if 'case' in item:
   for side in ['main','candidate']:samples.setdefault(('wasm',item['case'],side),[]).append(item[side]['median_ns'])
for profile,case in sorted(set((a,b) for a,b,_ in samples)):
 main=statistics.median(samples[profile,case,'main']);candidate=statistics.median(samples[profile,case,'candidate'])
 results.setdefault(profile,{})[case]={'main_median_ns':main,'candidate_median_ns':candidate,'delta_percent':round((candidate/main-1)*100,2),'main_samples_ns':samples[profile,case,'main'],'candidate_samples_ns':samples[profile,case,'candidate']}
summary={'affinity_cpu':cpu,'binary_sha256':binary_hashes,'profiles':results}
(root/'performance.json').write_text(json.dumps(summary,indent=2)+'\n')
for profile,cases in results.items():
 for case,v in cases.items():print(profile,case,round(v['main_median_ns']/1e6,4),round(v['candidate_median_ns']/1e6,4),v['delta_percent'])
