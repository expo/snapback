from pathlib import Path
import json,hashlib,tarfile,gzip
r=Path('/Users/ccheever/sb4-np/evidence/round5');sizes=[]
for name in ['final-a-ownbuild-1','measured-b-warm-ownbuild-1']:
 p=r/name/'base.app';target=r/(name+'.app.tar.gz')
 with target.open('xb') as output:
  with gzip.GzipFile(fileobj=output,mode='wb',mtime=0) as z:
   with tarfile.open(fileobj=z,mode='w|') as tar:tar.add(p,arcname='application.app')
 sizes.append({'name':name,'tarGzipBytes':target.stat().st_size,'tarGzipSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'path':str(target)})
(r/'compressed-app-sizes.json').write_text(json.dumps(sizes,indent=2)+'\n');print(sizes)
