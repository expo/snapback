#!/usr/bin/env python3
from pathlib import Path
import tempfile,shutil,subprocess,json,time,concurrent.futures,hashlib,sys
root=Path(__file__).resolve().parent;binary=Path(sys.argv[1]).resolve();out=root/sys.argv[2];out.mkdir(exist_ok=True)
jobs=[(lane,'noinv',['check','--json']) for lane in ['001','006','023','033','036','040','048']]+[(lane,'spec',['test','--all']) for lane in ['001','006','023','033','036','040','048']]+[('048','spec2',['test','--all'])]
def run(job):
 lane,mode,args=job
 with tempfile.TemporaryDirectory(prefix='sec6-remeasure-') as d:
  p=Path(d)
  for source in sorted((root/'inputs'/lane/mode/'snapback').rglob('*.q')):
   target=p/'snapback'/source.relative_to(root/'inputs'/lane/mode/'snapback');target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(source.read_bytes())
  t=time.monotonic();r=subprocess.run(['timeout','450s',str(binary),*args],cwd=p,capture_output=True,timeout=460)
  stem=out/f'{lane}-{mode}';stem.with_suffix('.out').write_bytes(r.stdout);stem.with_suffix('.err').write_bytes(r.stderr)
  row={'lane':lane,'mode':mode,'command':args,'exit':r.returncode,'seconds':round(time.monotonic()-t,2)};print(row,flush=True);return row
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:runs=list(pool.map(run,jobs))
(out/'runs.json').write_text(json.dumps({'binarySha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'runs':runs},indent=2)+'\n')
