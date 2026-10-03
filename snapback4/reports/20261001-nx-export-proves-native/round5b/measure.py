from pathlib import Path
import os,subprocess,time,json,hashlib,gzip,re,sys,statistics
work=Path('/Users/ccheever/sb4-np/nx-r5b');root=Path('/Users/ccheever/sb4-np/lane-nx/snapback4');report=root/'reports/20261001-nx-export-proves-native';out=report/'round5b'
archive=Path.home()/'sb4-np/evidence-archive/20261001-nx-export-proves-native/blobs'
node='/Users/ccheever/.volta/tools/image/node/24.18.0/bin'
def sha(b):return hashlib.sha256(b).hexdigest()
def retain(data,logical):
    digest=sha(data);dest=archive/digest
    if not dest.exists():dest.write_bytes(data)
    assert sha(dest.read_bytes())==digest
    with (report/'EVIDENCE-ARCHIVE.tsv').open('a') as f:f.write(f'{digest}\t{len(data)}\t{logical}\n')
    return dict(sha256=digest,bytes=len(data),path=logical)
def host():
    return dict(atMs=time.time_ns()//1000000,load=list(os.getloadavg()),topCpu=subprocess.check_output(['ps','-A','-o','pid,ppid,%cpu,comm','-r'],text=True).splitlines()[:21])
def wait_quiet(label):
    waited=0
    while os.getloadavg()[0]>float(os.environ.get('NX_MAX_START_LOAD','6')):
        snap=host()
        with (out/'waiting.jsonl').open('a') as f:f.write(json.dumps(dict(label=label,**snap))+'\n')
        print('waiting',label,'load',snap['load'],flush=True)
        if os.environ.get('NX_ALLOW_CONTENDED')=='1':return
        time.sleep(30);waited+=30
        if waited>=1800:raise RuntimeError('No quiet window in 30 minutes; retained load log; no samples silently relabeled.')
def run(rev,starter,label,measured):
    project=work/f'{rev}-{starter}';name=f'{rev}-{starter}-{label}';result=out/(name+'.json');assert not result.exists()
    if measured:
        candidates=sorted((project/'src').rglob('*.tsx')) if (project/'src').exists() else sorted((project/'app').rglob('*.tsx'))
        if not candidates:candidates=[project/'App.tsx']
        with candidates[0].open('a') as f:f.write('\n// NX round 5b warm JS-edit '+name+'.\n')
        wait_quiet(name)
    env=dict(os.environ);env.update(PATH=node+':'+env['PATH'],SNAPBACK4_BIN=str(work/'packages'/rev/'snapback4'),SNAPBACK4_SMOKE_DEVICE_PREFIX='sb4-nx-r5b-',CI='1')
    env.pop('SNAPBACK4_NATIVE_SMOKE',None)
    before=host();log=out/(name+'.log');start=time.time_ns()//1000000;clock=time.monotonic_ns()
    with log.open('x') as f:p=subprocess.run(['caffeinate','-i',node+'/npm','run','export:ios'],cwd=project,env=env,stdout=f,stderr=subprocess.STDOUT)
    elapsed=(time.monotonic_ns()-clock)/1e6;end=time.time_ns()//1000000;after=host()
    match=re.search(r'; receipt: (.+)',log.read_text());receipt_path=Path(match.group(1)) if match else None
    receipt=json.loads(receipt_path.read_text()) if receipt_path and receipt_path.exists() else {}
    pubpath=receipt_path.parent/'publication.json' if receipt_path else None
    publication=json.loads(pubpath.read_text()) if pubpath and pubpath.exists() else {}
    meta=json.loads((project/'dist/metadata.json').read_text()) if (project/'dist/metadata.json').exists() else None
    exported=sha((project/'dist'/meta['fileMetadata']['ios']['bundle']).read_bytes()) if meta and p.returncode==0 else None
    native=receipt.get('durationMs');evidence=[]
    if receipt_path:
      for file in sorted(receipt_path.parent.iterdir()):
        if file.is_file() and file.suffix!='.lock':
          data=file.read_bytes();filename=file.name
          if file.suffix not in ['.mp4','.gz','.png']:data=gzip.compress(data,mtime=0);filename+='.gz'
          evidence.append(retain(data,f'round5b/evidence/{name}/{filename}'))
    row=dict(cohort=os.environ.get('NX_COHORT','initial'),revision=rev,starter=starter,label=label,measured=measured and label.startswith('sample'),jsEdit=measured,project=str(project),startedAt=start,endedAt=end,durationMs=round(elapsed,3),nativeDurationMs=native,outsideMs=round(elapsed-native,3) if native else None,status=p.returncode,hostBefore=before,hostAfter=after,contended=before['load'][0]>6 or after['load'][0]>6,loadExceeded6Before=before['load'][0]>6,loadExceeded6After=after['load'][0]>6,receiptPath=str(receipt_path),cache=receipt.get('nativeCache'),exitStatus=receipt.get('exitStatus'),error=receipt.get('error'),nativeTimestamps={k:receipt.get(k) for k in ['invokedAt','startedAt','endedAt','durationMs']},segments={k:{a:b for a,b in v.items() if a in ['status','startedAt','endedAt','durationMs']} for k,v in receipt.get('segments',{}).items()},simulator=receipt.get('simulator'),publicationVerifiedAt=publication.get('verifiedAt'),loadedHash=receipt.get('installed',{}).get('javascript',{}).get('sha256'),exportHash=exported,publicationProofHash=publication.get('proofSha256'),proofHash=receipt.get('proof',{}).get('sha256'),publishedFiles=len(publication.get('files',[])),evidence=evidence)
    result.write_text(json.dumps(row,indent=2)+'\n');print(json.dumps({k:v for k,v in row.items() if k not in ['evidence','hostBefore','hostAfter','cache','segments']}),flush=True)
    assert p.returncode==0 and receipt.get('exitStatus')==0,'failed export retained: '+name
    assert all(v['status']=='passed' for v in receipt['segments'].values()) and len(receipt['segments'])==3
    assert exported==row['loadedHash'] and row['proofHash']==row['publicationProofHash'] and row['proofHash']
    assert row['simulator']['name'].startswith('sb4-nx-r5b-')
    if measured:assert row['cache']['hit'],'measured cache miss retained: '+name
if sys.argv[1]=='prime':
    for rev in ['r4','r5']:
        for starter in ['plain','social']:run(rev,starter,os.environ.get('NX_PRIME_LABEL','prime'),False)
elif sys.argv[1]=='warmup':
    for rev in ['r4','r5']:
        for starter in ['plain','social']:run(rev,starter,'warmup',True)
elif sys.argv[1]=='measure':
    counters={(r,s):0 for r in ['r4','r5'] for s in ['plain','social']}
    for block in range(3):
        for starter in (['plain','social'] if block%2==0 else ['social','plain']):
            for rev in ['r4','r5','r5','r4']:
                counters[rev,starter]+=1
                label='sample'+str(counters[rev,starter])
                if not (out/f'{rev}-{starter}-{label}.json').exists():run(rev,starter,label,True)

elif sys.argv[1]=='extend':
    for starter in ['plain','social']:
        def current():
            return [json.loads(p.read_text()) for p in out.glob('*-'+starter+'-sample*.json')]
        while any(sum(r['revision']==rev and not r['contended'] and r['status']==0 for r in current())<6 for rev in ['r4','r5']):
            for rev in ['r4','r5','r5','r4']:
                n=1+max([int(r['label'].removeprefix('sample')) for r in current() if r['revision']==rev],default=0)
                run(rev,starter,'sample'+str(n),True)

elif sys.argv[1]=='strict':
    for block in range(3):
        for starter in (['plain','social'] if block%2==0 else ['social','plain']):
            for rev in ['r4','r5','r5','r4']:
                current=[json.loads(p.read_text()) for p in out.glob(rev+'-'+starter+'-sample*.json')]
                n=1+max([int(r['label'].removeprefix('sample')) for r in current],default=0)
                run(rev,starter,'sample'+str(n),True)
