import json, re, statistics, subprocess, sys, time
from pathlib import Path
root=Path('target/d2/r2')
label=sys.argv[2] if len(sys.argv)>2 else 'paired'
candidate=sys.argv[3] if len(sys.argv)>3 else 'after'
control=sys.argv[4] if len(sys.argv)>4 else 'before'
mode=sys.argv[1]
configs={
 'sqlite':('device',['following::app::w6a_wired_following_sqlite','--exact']),
 'server':('clique',['w6a_wired_following_is_bounded_and_removes_app_events','--exact']),
 'device':('device',['following::app::w6a_wired_following_']),
 'acquisition':('device',['following::calibration::w8b_wired_calibration_acquisition_on_server_and_both_stores','--exact']),
}
exe,args=configs[mode]
records=[]
for trial in range(7):
 for stage in (['before','after'] if trial%2==0 else ['after','before']):
  command=[str(root/(control if stage=='before' else candidate)/exe),*args,'--nocapture','--test-threads=1']
  start=time.monotonic()
  result=subprocess.run(command,capture_output=True,text=True,timeout=1200)
  wall=time.monotonic()-start
  output=result.stdout+result.stderr
  (root/f'{label}-{mode}-{trial}-{stage}.log').write_text(output)
  if result.returncode or '0 passed;' in output or 'test result: ok.' not in output:
   raise RuntimeError(f'{stage}/{trial}: {result.returncode}\n{output[-5000:]}')
  measures={'wall_s':wall}
  for line in output.splitlines():
   host=re.search(r'host=(\w+)',line)
   if not host:continue
   follows=re.search(r'follows=(\d+)',line)
   suffix='/'+follows[1] if follows else ''
   for name in ['first_ms','p50_ms','p95_ms','snapshot_ms','apply_ms','cold_rows','cold_bytes']:
    match=re.search(r'\b'+name+r'=([0-9.]+)',line)
    if match:measures[host[1]+suffix+'/'+name]=float(match[1])
  records.append({'trial':trial,'stage':stage,'command':command,'measurements':measures})
  (root/f'{label}-{mode}.json').write_text(json.dumps({'records':records},indent=2)+'\n')
  print(mode,trial,stage,measures,flush=True)
medians={stage:{key:statistics.median(record['measurements'][key] for record in records if record['stage']==stage) for key in records[0]['measurements']} for stage in ['before','after']}
ratios={key:medians['after'][key]/medians['before'][key] for key in medians['before']}
(root/f'{label}-{mode}.json').write_text(json.dumps({'records':records,'medians':medians,'ratios':ratios},indent=2)+'\n')
print(json.dumps({'medians':medians,'ratios':ratios},indent=2),flush=True)
