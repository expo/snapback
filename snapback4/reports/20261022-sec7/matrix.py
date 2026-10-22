#!/usr/bin/env python3
"""Frozen wave22 evidence copies; no credentials or source writes to lanes."""
import pathlib,tempfile,subprocess,json,re,hashlib,time,argparse
from concurrent.futures import ThreadPoolExecutor,as_completed
ROOT=pathlib.Path(__file__).resolve().parent
parser=argparse.ArgumentParser();parser.add_argument('--binary',default=str(ROOT.parents[1]/'target/sec7-final-cli'));parser.add_argument('--out',default='matrix');options=parser.parse_args()
BINARY=str(pathlib.Path(options.binary).resolve())
OUT=ROOT/options.out;OUT.mkdir(exist_ok=True)
LANES=['004','011','021','026','030','037','040','044']
def one(item):
 lane,variant=item
 label=lane+('-specF2' if lane=='044' else '-spec') if variant=='spec' else lane+'-final'
 source=pathlib.Path.home()/'sb4-loop/wave22-repro/q1'/label/'snapback'
 with tempfile.TemporaryDirectory(prefix='sec7-matrix-') as tmp:
  root=pathlib.Path(tmp);(root/'snapback').mkdir();texts=[]
  for p in sorted(source.glob('*.q')):
   s=p.read_text();s='\n'.join(l for l in s.splitlines() if not l.lstrip().startswith('invariant '))+'\n' if variant=='none' else s
   (root/'snapback'/p.name).write_text(s);texts.append((p.name,s))
  def run(args,secs=300):
   r=subprocess.run(['timeout',str(secs),BINARY]+args,cwd=root,capture_output=True,text=True);return r,r.stdout+'\n'+r.stderr
  check,ct=run(['check','--json'],30);human,ht=run(['check'],30)
  try:j=json.loads(check.stdout)
  except:j={}
  test,tt=run(['test'])
  row=dict(lane=lane,variant=variant,sha256=hashlib.sha256(json.dumps(texts).encode()).hexdigest(),checkExit=check.returncode,testExit=test.returncode,visible=sorted(set(re.findall(r'N_[A-Z_]+',ht))),gates=[d['code'] for d in j.get('securityReviews',[]) if d.get('gated') and not d.get('acknowledged')],summary=[l for l in tt.splitlines() if l.startswith(('security tests:','security histories:','security not covered:','security:','test:'))])
  (OUT/(lane+'-'+variant+'.txt')).write_text(tt);(OUT/(lane+'-'+variant+'.json')).write_text(json.dumps(row,indent=2));print(lane,variant,check.returncode,test.returncode,flush=True);return row
with ThreadPoolExecutor(max_workers=4) as pool:rows=[f.result() for f in as_completed([pool.submit(one,(l,v)) for l in LANES for v in ['none','own','spec']])]
(OUT/'results.json').write_text(json.dumps(sorted(rows,key=lambda r:(r['lane'],r['variant'])),indent=2))
