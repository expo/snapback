from pathlib import Path
import hashlib,json,gzip

r=Path(__file__).resolve().parent
root=r.parents[2]
read=lambda name:json.loads((r/name).read_text())
for row in read('final-source.json')['files']:
    data=(root/row['path']).read_bytes()
    assert len(data)==row['bytes'] and hashlib.sha256(data).hexdigest()==row['sha256'],row['path']
samples=[]
for starter in ['plain','social']:
    hashes=[]
    for index in range(6):
        row=read(f'{starter}-'+('cold' if index==0 else f'warm{index}')+'.json')
        assert row['status']==row['receiptExit']==0 and row['cache']['hit']==(index>0)
        assert row['bundleHash']==row['loadedHash'] and set(row['segments'].values())=={'passed'}
        hashes.append(row['loadedHash'])
    assert len(set(hashes))==6
    warm=read(f'{starter}-warm-summary.json')
    assert warm['medianMs']==sorted(warm['times'])[2]
    controls=read(f'{starter}-lifecycle-controls.json')
    assert len(controls)==4 and controls[0]['cleaned'] and controls[1]['heartbeatStopped'] and controls[1]['cleaned']
    assert controls[2]['emptyStdout'] and controls[2]['deleted']
    assert controls[3]['bRefusedCustody'] and controls[3]['privateHash']==controls[3]['loadedHash']==controls[3]['distHash']
    samples.append({'starter':starter,'medianMs':warm['medianMs'],'targetMet':warm['medianMs']<=25000,'distinctBundles':len(set(hashes))})
archive_files=0
for index in (r/'evidence').glob('*/inventory.json'):
    for row in json.loads(index.read_text()):
        data=gzip.decompress((index.parent/(row['name']+'.gz')).read_bytes())
        assert len(data)==row['bytes'] and hashlib.sha256(data).hexdigest()==row['sha256']
        archive_files+=1
assert len(read('config-controls.json'))==8
assert read('full-suite-status.json')['invocations']==1
assert read('cleanup.json')['allRunDevicesAbsent']
result={'sourceManifestUnchanged':True,'cohorts':samples,'archivedControlFilesVerified':archive_files,'canonicalSuiteInvocations':1,'allRunDevicesAbsent':True}
(r/'verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
