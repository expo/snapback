import time,os,json
from pathlib import Path
out=Path(__file__).resolve().parent
def sample():
 return {int(p[0][3:]):list(map(int,p[1:])) for line in Path('/proc/stat').read_text().splitlines() if (p:=line.split())[0].startswith('cpu') and p[0]!='cpu'}
a=sample();time.sleep(3);b=sample();rows=[]
for c in sorted(os.sched_getaffinity(0)):
 ds=[y-x for x,y in zip(a[c],b[c])];total=sum(ds[:8]);idle=ds[3]+ds[4]
 rows.append({'cpu':c,'busy':round(100*(1-idle/total),1),'siblings':list(map(int,Path(f'/sys/devices/system/cpu/cpu{c}/topology/thread_siblings_list').read_text().strip().split(',')))})
busy={r['cpu']:r['busy'] for r in rows}
physical=sorted((r for r in rows if r['cpu']==min(r['siblings'])),key=lambda r:max(busy[s] for s in r['siblings']))
chosen=[r['cpu'] for r in physical if all(busy[s]<=5 for s in r['siblings'])][:24]
(out/'idle-sample.json').write_text(json.dumps({'chosen':chosen,'sampleSeconds':3,'cpus':rows},indent=2))
assert len(chosen)==24,chosen
(out/'cpus.txt').write_text(','.join(map(str,chosen)))
print('Idle CPUs and siblings verified:',chosen,flush=True)
