#!/usr/bin/env python3
"""Read-only wave23 schemas; copied experiments clean their own scratch."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor,as_completed
import json,hashlib,tempfile,subprocess,re,argparse
parser=argparse.ArgumentParser();parser.add_argument('--binary',required=True);parser.add_argument('--out',required=True);a=parser.parse_args();binary=str(Path(a.binary).resolve());out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
base=Path.home()/'sb4-loop/wave23-repro/sec'
def one(lane,variant):
 source=(base/('spec' if variant=='spec' else 'all')/lane/'snapback/schema.q').read_text()
 if variant=='none':source='\n'.join(l for l in source.splitlines() if not l.lstrip().startswith('invariant '))+'\n'
 with tempfile.TemporaryDirectory(prefix='sec7-day2-matrix-') as tmp:
  project=Path(tmp);(project/'snapback').mkdir();(project/'snapback/schema.q').write_text(source)
  def run(args,seconds):return subprocess.run(['timeout',str(seconds),binary,*args],cwd=project,capture_output=True,text=True)
  check=run(['check','--json'],30);human=run(['check'],30);test=run(['test'],300)
  checked=json.loads(check.stdout);text=test.stdout+'\n'+test.stderr
  (out/(lane+'-'+variant+'.txt')).write_text(text)
  row={'lane':lane,'variant':variant,'sourceSha256':hashlib.sha256(source.encode()).hexdigest(),'checkExit':check.returncode,'testExit':test.returncode,'codes':sorted(set(n['code'] for n in checked.get('security',{}).get('notes',[]))),'visible':sorted(set(re.findall(r'N_[A-Z_]+',human.stdout))),'gates':[n['code'] for n in checked.get('securityReviews',[]) if n['gated'] and not n['acknowledged']],'summary':[line for line in text.splitlines() if line.startswith(('security tests:','security histories:','security directed histories:','security not covered:','security:','test:'))]}
  print(lane,variant,check.returncode,test.returncode,flush=True);return row
with ThreadPoolExecutor(max_workers=4) as pool:rows=[f.result() for f in as_completed([pool.submit(one,l,v) for l in ['003','028','039','041','042'] for v in ['none','own','spec']])]
(out/'results.json').write_text(json.dumps(sorted(rows,key=lambda r:(r['lane'],r['variant'])),indent=2)+'\n')
