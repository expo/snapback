#!/usr/bin/env python3
"""Mechanical acknowledgment-path probe, not a judgment that gates are false."""
import pathlib,json,tempfile,subprocess,argparse
from concurrent.futures import ThreadPoolExecutor,as_completed
ROOT=pathlib.Path(__file__).resolve().parent
parser=argparse.ArgumentParser();parser.add_argument('--binary',default=str(ROOT.parents[1]/'target/sec7-final-cli'));parser.add_argument('--corpus',default='final-corpus');parser.add_argument('--out',default='review-cost');options=parser.parse_args();binary=str(pathlib.Path(options.binary).resolve())
rows=json.loads((ROOT/options.corpus/'results.json').read_text());items=[r for r in rows if r['variant']=='own' and r['gates']]
OUT=ROOT/options.out;OUT.mkdir(exist_ok=True)
def probe(row):
 cached=OUT/(row['lane']+'.json')
 if cached.exists():return json.loads(cached.read_text())
 wave,label=row['lane'].split('-',1);source=pathlib.Path.home()/('sb4-loop/wave'+wave[1:])/'apps'/label/'snapback'
 with tempfile.TemporaryDirectory(prefix='sec7-review-cost-') as tmp:
  root=pathlib.Path(tmp);(root/'snapback').mkdir()
  for q in source.glob('*.q'):(root/'snapback'/q.name).write_bytes(q.read_bytes())
  def run(args):return subprocess.run(['timeout','30',binary]+args,cwd=root,text=True,capture_output=True)
  initial=run(['check','--json']);j=json.loads(initial.stdout);pending=[d for d in j.get('securityReviews',[]) if d['gated'] and not d['acknowledged']]
  exits=[]
  for d in pending:exits.append(run(['check','--ack-security',d['id'],'--reason','SEC7 mechanical review-path experiment only; not an assertion that this workflow meets its specification.']).returncode)
  final=run(['check','--json']);data=json.loads(final.stdout)
  result=dict(lane=row['lane'],before=initial.returncode,notes=len(pending),codes=[d['code'] for d in pending],ackExits=exits,after=final.returncode,pendingAfter=sum(d['gated'] and not d['acknowledged'] for d in data.get('securityReviews',[])))
  (OUT/(row['lane']+'.json')).write_text(json.dumps(result,indent=2));print(row['lane'],final.returncode,flush=True);return result
with ThreadPoolExecutor(max_workers=6) as pool:results=[f.result() for f in as_completed([pool.submit(probe,row) for row in items])]
(OUT/'results.json').write_text(json.dumps(sorted(results,key=lambda r:r['lane']),indent=2))
