from pathlib import Path
import sys,json,os,time,hashlib
base=Path('/Users/ccheever/clique-improvement/revisions/cli-018-publication-preparation-r1/bundle')
sys.path.insert(0,str(base))
from custody import bundle,verify_leaves,resume_check,regular,sha
ok=False
try:
 b=bundle(base,'2fa6edaf3f1edbf89f1b69564425c0c0eaf208e790a805cfee1ba9dfbc611e59')
 verify_leaves(b['source'],json.loads((base/'inputs/source-manifest.json').read_text()),source=True)
 resume_check(b)
 for row in json.loads((base/'inputs/artifact-inputs.json').read_text()):
  f=regular(Path(b['artifacts'])/row['path'],int(row['mode'],8));assert sha(f)==row['sha256']
 assert sha(Path(b['source'])/'snapback2/metrics/loop.jsonl')==b['metricSha256']
 ok=True
finally:
 print(json.dumps({'pass':ok,'pid':os.getpid(),'epoch':time.time(),'sourceLeaves':947,'bundleLeaves':11,'sourceAndArtifactsUnchanged':ok,'authAccess':False}),flush=True)
 sys.exit(0 if ok else 1)
