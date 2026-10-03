from pathlib import Path
import gzip,hashlib,json,tarfile,io
root=Path(__file__).resolve().parents[3]; report=Path(__file__).resolve().parent
blobs=Path.home()/'sb4-np/evidence-archive/20261001-nx-export-proves-native/blobs'
index=report.parent/'EVIDENCE-ARCHIVE.tsv'; rows=[]; summaries={}
def put(data,name):
    digest=hashlib.sha256(data).hexdigest(); target=blobs/digest
    if not target.exists():target.write_bytes(data)
    assert hashlib.sha256(target.read_bytes()).hexdigest()==digest
    entry={'sha256':digest,'bytes':len(data),'path':'round9/'+name};rows.append(entry);return entry
for summary in sorted(report.glob('*.json')):
    d=json.loads(summary.read_text())
    if not isinstance(d,dict) or not d.get('receiptPath'):continue
    artifact=Path(d['receiptPath']).parent
    entries=[]
    for p in sorted(artifact.rglob('*')):
        if p.is_symlink():
            entries.append(put(json.dumps({'target':str(p.readlink())}).encode(),'evidence/'+summary.stem+'/'+str(p.relative_to(artifact))+'.link.json'))
        elif p.is_file():
            entries.append(put(gzip.compress(p.read_bytes(),mtime=0),'evidence/'+summary.stem+'/'+str(p.relative_to(artifact))+'.gz'))
    summaries[summary.stem]={'artifacts':str(artifact),'files':len(entries),'entries':entries}
for p in sorted((root/'target/nx/round9/packages').glob('*.tgz')):
    put(p.read_bytes(),'packages/'+p.name)
for name in ['plain','social']:
    p=root/'target/nx/round9'/name; buffer=io.BytesIO()
    with tarfile.open(fileobj=buffer,mode='w:gz') as tar:
        for child in p.iterdir():
            if child.name not in ['node_modules','.snapback4','.snapback4-witness','artifacts','dist']:
                tar.add(child,arcname=child.name)
    put(buffer.getvalue(),name+'-starter-source.tar.gz')
put((root/'target/production/snapback4').read_bytes(),'snapback4-production')
existing=set(line.split('\t',2)[2] for line in index.read_text().splitlines() if not line.startswith('#') and '\t' in line)
with index.open('a') as out:
    for item in rows:
        assert item['path'] not in existing,item['path'];existing.add(item['path'])
        out.write(f"{item['sha256']}\t{item['bytes']}\t{item['path']}\n")
document={'summaries':summaries,'other': [x for x in rows if not x['path'].startswith('round9/evidence/')]}
payload=(json.dumps(document,indent=2)+'\n').encode()
if len(payload)>250000:
    entry=put(gzip.compress(payload,mtime=0),'native-evidence-full.json.gz')
    with index.open('a') as out:out.write(f"{entry['sha256']}\t{entry['bytes']}\t{entry['path']}\n")
    document={'summaries':{name:{'artifacts':value['artifacts'],'files':value['files']} for name,value in summaries.items()},'other':document['other'],'fullInventory':entry}
(report/'native-evidence.json').write_text(json.dumps(document,indent=2)+'\n')
print(json.dumps({'entries':len(rows),'allReadBackVerified':True}))
