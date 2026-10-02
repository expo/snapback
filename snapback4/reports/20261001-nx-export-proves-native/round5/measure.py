from pathlib import Path
import os,subprocess,time,json,hashlib,gzip
root=Path.cwd();report=root/'reports/20261001-nx-export-proves-native';out=report/'round5'
archive=Path.home()/'sb4-np/evidence-archive/20261001-nx-export-proves-native/blobs';archive.mkdir(parents=True,exist_ok=True)
def sha(b):return hashlib.sha256(b).hexdigest()
def retain(data,logical):
    digest=sha(data);dest=archive/digest
    if not dest.exists():dest.write_bytes(data)
    assert sha(dest.read_bytes())==digest
    with (report/'EVIDENCE-ARCHIVE.tsv').open('a') as f:f.write(f'{digest}\t{len(data)}\t{logical}\n')
    return dict(sha256=digest,bytes=len(data),path=logical)
env=dict(os.environ);env.update(PATH='/Users/ccheever/.volta/tools/image/node/24.18.0/bin:'+env['PATH'],SNAPBACK4_BIN=str(root/'target/production/snapback4'),SNAPBACK4_SMOKE_DEVICE_PREFIX='sb4-nx-r5-',CI='1')
suffix=os.environ.get('NX_MEASUREMENT_SUFFIX','')
for phase in os.environ.get('NX_MEASUREMENT_PHASES','prime,warm').split(','):
 label=phase+suffix
 for starter in ['plain','social']:
    project=root/'target/nx'/starter
    if phase.startswith('warm'):
        candidates=list((project/'src').rglob('*.tsx')) if (project/'src').exists() else list((project/'app').rglob('*.tsx'))
        if not candidates:candidates=[project/'App.tsx']
        with candidates[0].open('a') as f:f.write('\n// NX round 5 warm export receipt regression.\n')
    result=out/f'{starter}-{label}.json';assert not result.exists()
    log=out/f'{starter}-{label}.log';start=time.time()
    with log.open('x') as f:p=subprocess.run(['caffeinate','-i','/Users/ccheever/.volta/tools/image/node/24.18.0/bin/npm','run','export:ios'],cwd=project,env=env,stdout=f,stderr=subprocess.STDOUT)
    elapsed=round((time.time()-start)*1000);text=log.read_text();import re
    match=re.search(r'; receipt: (.+)',text);receipt_path=Path(match.group(1)) if match else None
    receipt=json.loads(receipt_path.read_text()) if receipt_path and receipt_path.exists() else {}
    publication=json.loads((receipt_path.parent/'publication.json').read_text()) if receipt_path and (receipt_path.parent/'publication.json').exists() else {}
    meta=json.loads((project/'dist/metadata.json').read_text()) if (project/'dist/metadata.json').exists() else None
    exported=sha((project/'dist'/meta['fileMetadata']['ios']['bundle']).read_bytes()) if meta and p.returncode==0 else None
    evidence=[]
    if receipt_path:
      for file in sorted(receipt_path.parent.iterdir()):
        if file.is_file() and file.suffix not in ['.lock']:
          data=file.read_bytes();name=file.name
          if file.suffix not in ['.mp4','.gz','.png']:data=gzip.compress(data,mtime=0);name+='.gz'
          evidence.append(retain(data,f'round5/evidence/{starter}-{label}/{name}'))
      for name in ['base.app','export.app','build.xcresult','preparation-tmp','export']:assert not (receipt_path.parent/name).exists(),name
    row=dict(starter=starter,label=label,startedAt=int(start*1000),durationMs=elapsed,status=p.returncode,receiptPath=str(receipt_path),cache=receipt.get('nativeCache'),exitStatus=receipt.get('exitStatus'),error=receipt.get('error'),segments={k:v['status'] for k,v in receipt.get('segments',{}).items()},loadedHash=receipt.get('installed',{}).get('javascript',{}).get('sha256'),exportHash=exported,publicationProofHash=publication.get('proofSha256'),proofHash=receipt.get('proof',{}).get('sha256'),publishedFiles=len(publication.get('files',[])),evidence=evidence)
    result.write_text(json.dumps(row,indent=2)+'\n');print(json.dumps({k:v for k,v in row.items() if k!='evidence'}),flush=True)
    if p.returncode:raise RuntimeError('retained failed export: '+str(result))
