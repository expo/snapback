from pathlib import Path
import gzip,hashlib,json
report=Path(__file__).resolve().parent
blobs=Path.home()/'sb4-np/evidence-archive/20261001-nx-export-proves-native/blobs'
index=report.parent/'EVIDENCE-ARCHIVE.tsv';existing={}
for line in index.read_text().splitlines():
 if not line.startswith('#') and '\t' in line:
  sha,size,name=line.split('\t',2);existing[name]={'sha256':sha,'bytes':int(size),'path':name}
rows=[];entries=[]
for p in sorted(report.rglob('*.log')):
 rel=str(p.relative_to(report));raw=p.read_bytes();key='round9/'+rel+'.raw.gz'
 # Initial Linux originals were archived before formatting; reuse those bytes.
 earlier=existing.get('round9/linux-original/'+p.name)
 if rel.startswith('linux-logs/') and earlier:
  item={**earlier,'encoding':'identity'};original=(blobs/item['sha256']).read_bytes()
 else:
  data=gzip.compress(raw,mtime=0);sha=hashlib.sha256(data).hexdigest();f=blobs/sha
  if not f.exists():f.write_bytes(data)
  assert f.read_bytes()==data
  item={'sha256':sha,'bytes':len(data),'path':key};assert key not in existing;entries.append(item);original=raw
 text=raw.decode();p.write_text('\n'.join(line.rstrip() for line in text.splitlines()).rstrip()+'\n' if text.strip() else '')
 rows.append({'path':rel,'rawSha256':hashlib.sha256(original).hexdigest(),'committedSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'rawArchive':item})
with index.open('a') as out:
 for x in entries:out.write(f"{x['sha256']}\t{x['bytes']}\t{x['path']}\n")
(report/'small-log-formatting.json').write_text(json.dumps(rows,indent=2)+'\n')
print(json.dumps({'views':len(rows),'newArchiveEntries':len(entries)}))
