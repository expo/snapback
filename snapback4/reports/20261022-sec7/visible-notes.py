#!/usr/bin/env python3
import pathlib,tempfile,subprocess,json,gzip,hashlib,argparse
from concurrent.futures import ThreadPoolExecutor,as_completed
ROOT=pathlib.Path(__file__).resolve().parent
parser=argparse.ArgumentParser();parser.add_argument('--before',default=str(ROOT.parents[1]/'target/sec7-baseline'));parser.add_argument('--after',default=str(ROOT.parents[1]/'target/sec7-typed-cli'));parser.add_argument('--out',default='visible-notes.json.gz');options=parser.parse_args()
sources=sorted(pathlib.Path.home().glob('sb4-loop/wave22/apps/*-snapback-*/snapback'))
def one(source):
 row={'lane':source.parent.name}
 with tempfile.TemporaryDirectory(prefix='sec7-visible-') as tmp:
  cwd=pathlib.Path(tmp);(cwd/'snapback').mkdir()
  for q in source.glob('*.q'):(cwd/'snapback'/q.name).write_bytes(q.read_bytes())
  for phase,name in [('before',options.before),('after',options.after)]:
   r=subprocess.run(['timeout','30',str(pathlib.Path(name).resolve()),'check'],cwd=cwd,capture_output=True,text=True)
   row[phase]={'exit':r.returncode,'lines':[l for l in (r.stdout+'\n'+r.stderr).splitlines() if l.startswith(('note:','security review required','security reviewed'))]}
 return row
with ThreadPoolExecutor(max_workers=6) as pool:rows=[f.result() for f in as_completed([pool.submit(one,s) for s in sources])]
with gzip.GzipFile(filename=str(ROOT/options.out),mode='wb',mtime=0) as f:f.write((json.dumps(sorted(rows,key=lambda r:r['lane']),indent=2)+'\n').encode())
print('retained exact default note lines for',len(rows),'projects, before and after')
