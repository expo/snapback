from pathlib import Path
import hashlib,json,subprocess
root=Path(__file__).resolve().parents[4]; report=Path(__file__).resolve().parent
prefix=str(report.relative_to(root))+'/'
def git(*args):return subprocess.check_output(['git',*args],cwd=root)
parent_blobs=set()
for parent in ['HEAD','MERGE_HEAD']:
 for line in git('ls-tree','-r',parent).decode().splitlines():
  meta,path=line.split('\t',1);mode,kind,oid=meta.split()
  if kind=='blob':parent_blobs.add(oid)
novel=[]
for line in git('ls-files','--stage').decode().splitlines():
 meta,path=line.split('\t',1);mode,oid,stage=meta.split();assert stage=='0'
 if mode=='160000':continue  # Gitlinks name commits, not evidence blobs.
 if oid not in parent_blobs and path!=prefix+'staged-size.json':
  data=git('cat-file','blob',oid);novel.append({'path':path,'bytes':len(data),'oid':oid,'sha256':hashlib.sha256(data).hexdigest()})
assert novel
raw=[x['path'] for x in novel if Path(x['path']).suffix in ['.gz','.tgz','.wasm','.mp4','.png','.zip','.tar']]
assert not raw,raw
assert all(x['bytes']<15_000_000 for x in novel)
assert sum(x['bytes'] for x in novel)<15_000_000
assert all(x['bytes']<256*1024 for x in novel if x['path'].startswith(prefix)),[(x['path'],x['bytes']) for x in novel if x['path'].startswith(prefix) and x['bytes']>=256*1024]
expected=json.loads((report/'suite-start-source.json').read_text())
for d in json.loads((report/'final-source-validation.json').read_text())['postCanonicalDelta']:expected[d['path']]=d['finalSha256']
for p,sha in expected.items():assert hashlib.sha256(git('show',':'+p)).hexdigest()==sha,p
blobs=Path.home()/'sb4-np/evidence-archive/20261001-nx-export-proves-native/blobs';rows=[]
for line in (report.parent/'EVIDENCE-ARCHIVE.tsv').read_text().splitlines():
 if line.startswith('#') or '\t' not in line:continue
 sha,size,path=line.split('\t',2)
 if path.startswith('round9/'):
  data=(blobs/sha).read_bytes();assert len(data)==int(size) and hashlib.sha256(data).hexdigest()==sha,path;rows.append((sha,path))
assert len(set(p for sha,p in rows))==len(rows)
check=subprocess.run(['git','diff','--cached','--check','HEAD','--',*[x['path'] for x in novel]],cwd=root,capture_output=True,text=True)
(report/'novel-whitespace-check.log').write_text(check.stdout+check.stderr)
assert check.returncode==0,check.stdout+check.stderr
result={'scope':'Novel staged blobs relative to BOTH merge parents; inherited parent evidence is unchanged and excluded.','novelStagedFilesExcludingThisAudit':len(novel),'totalNovelBlobBytesExcludingThisAudit':sum(x['bytes'] for x in novel),'largestBlob':max(novel,key=lambda x:x['bytes']),'allNovelBlobsUnder15MB':True,'totalNovelBlobsUnder15MB':True,'newRound9FilesUnder256KiB':True,'rawBinaryOrGzipPathsInNewStage':raw,'newExternalPathsVerified':len(rows),'newExternalDistinctBlobsVerified':len(set(s for s,p in rows)),'testedSourceMatchesStage':True,'canonicalPostRunDelta':'Exact cache pins only; final mini/Linux witness, JS export/shim and native proofs verified.','canonicalSummary':'== 2 failure(s) in 2585 s','canonicalInvocations':1,'novelWhitespaceCheck':True}
(report/'staged-size.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
