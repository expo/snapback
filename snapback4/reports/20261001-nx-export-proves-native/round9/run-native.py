from pathlib import Path
import hashlib, json, os, subprocess, time
root=Path(__file__).resolve().parents[3];report=Path(__file__).resolve().parent
base=root/'target/nx/round9'; env=dict(os.environ)
env.update(PATH=str(Path.home()/'.volta/bin')+':'+env['PATH'], SNAPBACK4_BIN=str(root/'target/production/snapback4'), SNAPBACK4_SMOKE_DEVICE_PREFIX='sb4-nx-r9-', XDG_STATE_HOME=str(base/'sim-state'), CI='1')
env.pop('SNAPBACK4_NATIVE_SMOKE',None)
attempt=os.environ.get('NX_ATTEMPT','')
if attempt:
    while not (report/'full-suite-status.json').exists(): time.sleep(30)
    while os.getloadavg()[0] > 6: time.sleep(30)
for starter in ['plain','social']:
 for phase in ['prime','warm']:
    project=base/starter; label=starter+'-'+phase+('-'+attempt if attempt else ''); log=report/(label+'.log')
    before=time.time(); load=os.getloadavg()
    with log.open('x') as out:
        child=subprocess.Popen(['npm','run','export:ios'],cwd=project,env=env,stdout=out,stderr=subprocess.STDOUT)
        (report/(label+'-process.json')).write_text(json.dumps({'pid':child.pid,'startedAt':before,'load':load},indent=2)+'\n')
        status=child.wait()
    duration=time.time()-before; text=log.read_text(); receipt_path=None
    for line in text.splitlines():
        if 'native smoke ' in line and '; receipt: ' in line: receipt_path=line.split('; receipt: ',1)[1]
    receipt=json.loads(Path(receipt_path).read_text()) if receipt_path and Path(receipt_path).exists() else {}
    row={'starter':starter,'phase':phase,'status':status,'durationSeconds':duration,'startedAt':before,'loadBefore':load,'loadAfter':os.getloadavg(),'receiptPath':receipt_path,'receiptExit':receipt.get('exitStatus'),'proofKind':receipt.get('proofKind'),'cache':receipt.get('nativeCache'),'udid':receipt.get('udid'),'simulator':receipt.get('simulator'),'nativeDurationMs':receipt.get('durationMs'),'error':receipt.get('error'),'segments':{k:v.get('status') for k,v in receipt.get('segments',{}).items()}}
    if receipt_path:
        artifact=Path(receipt_path).parent
        for file in ['proof.json','publication.json']:
            p=artifact/file
            if p.exists():row[file]={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
        proof=json.loads((artifact/'proof.json').read_text()) if (artifact/'proof.json').exists() else {}
        metadata=json.loads((project/'dist/metadata.json').read_text()) if (project/'dist/metadata.json').exists() else {}
        if metadata:
            hbc=project/'dist'/metadata['fileMetadata']['ios']['bundle']; row['exportedBundleSha256']=hashlib.sha256(hbc.read_bytes()).hexdigest();row['installedBundleSha256']=receipt.get('installed',{}).get('javascript',{}).get('sha256')
    (report/(label+'.json')).write_text(json.dumps(row,indent=2)+'\n');print(json.dumps(row),flush=True)
    assert status==0 and receipt.get('exitStatus')==0 and row['segments']=={'prime':'passed','offline':'passed','restart':'passed'},row
    assert row['exportedBundleSha256']==row['installedBundleSha256'],row
    assert 'publication.json' in row,row
    if phase=='warm':assert row['cache']['hit'] is True,row
