#!/usr/bin/env python3
"""Read-only physical tuple hashes across exact-request C ABI replays."""
import hashlib,json,sqlite3
from pathlib import Path
root=Path(__file__).resolve().parents[4]
paths=['target/na-capture-before/direct-final-ffi.sqlite','target/na-capture-before/round1-ffi.sqlite']
results=[]
for path in paths:
 db=sqlite3.connect('file:'+str(root/path)+'?mode=ro',uri=True)
 tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
 record={'path':path,'integrity':db.execute('pragma integrity_check').fetchone()[0],'journalMode':db.execute('pragma journal_mode').fetchone()[0],'tables':{}}
 for name in ['r','i','_cap_counts','_device_residency']:
  if name not in tables: continue
  columns=len(db.execute('SELECT * FROM "'+name+'" LIMIT 0').description)
  h=hashlib.sha256();count=0
  for row in db.execute('SELECT * FROM "'+name+'" ORDER BY '+','.join(str(i+1) for i in range(columns))):
   h.update(json.dumps([{'blob':v.hex()} if isinstance(v,bytes) else v for v in row],separators=(',',':')).encode()+b'\n');count+=1
  record['tables'][name]={'count':count,'sha256':h.hexdigest()}
 record['metaHashes']={k:hashlib.sha256(v.encode()).hexdigest() for k,v in db.execute('SELECT key,value FROM _meta') if k!='store_id'}
 results.append(record);db.close()
assert results[0]['tables']==results[1]['tables']
changed=[k for k in results[0]['metaHashes'].keys() | results[1]['metaHashes'].keys() if results[0]['metaHashes'].get(k)!=results[1]['metaHashes'].get(k)]
Path(__file__).with_name('store-comparison.json').write_text(json.dumps({'stores':results,'allPhysicalTablesEqual':True,'changedMetaKeys':changed},indent=2)+'\n')
print('Physical tables equal:',results[1]['tables']);print('Changed metadata keys:',changed)
