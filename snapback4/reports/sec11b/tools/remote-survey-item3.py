import hashlib,json,os,pathlib,platform,shutil,signal,subprocess,sys,tarfile,time
root=pathlib.Path(__file__).resolve().parent;assert str(root).startswith('/tmp/sec11b-item3-')
manifest=json.loads((root/'inputs-manifest.json').read_text());expected=json.loads((root/'provenance.json').read_text())['binarySha256'];binary=root/'snapback4';assert hashlib.sha256(binary.read_bytes()).hexdigest()==expected
with tarfile.open(root/'inputs.tar.gz')as archive:
 for member in archive.getmembers():
  assert member.isfile()and member.name.startswith('input/')and'..'not in pathlib.PurePosixPath(member.name).parts
  target=root/member.name;target.parent.mkdir(parents=True,exist_ok=True)
  with archive.extractfile(member)as source,target.open('wb')as dest:shutil.copyfileobj(source,dest)
for name,sha in manifest.items():assert hashlib.sha256((root/'input'/name).read_bytes()).hexdigest()==sha
binary.chmod(0o700);version=subprocess.check_output([str(binary),'--version'],text=True,timeout=30).strip();floor=25*1024**3;assert shutil.disk_usage(root).free>=floor
if sys.argv[1]=='probe':print(json.dumps(dict(host=platform.node(),binarySha256=expected,version=version,inputs=len(manifest),freeBytes=shutil.disk_usage(root).free)));sys.exit(0)
started=time.monotonic();free_before=shutil.disk_usage(root).free;waves=sys.argv[1];out=root/'out';log=(root/'survey.log').open('w')
command=['python3',str(root/'survey.py'),'--binary',str(binary),'--out',str(out),'--input-root',str(root/'input'),'--waves',waves,'--default-output','--workers','6','--check-timeout','1200','--deploy-timeout','1200','--test-timeout','3600']
p=subprocess.Popen(command,cwd=root,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);(root/'run-state.json').write_text(json.dumps(dict(pid=p.pid,command=command,host=platform.node()),indent=2))
guard=None
while p.poll()is None:
 if shutil.disk_usage(root).free<floor:
  guard='25 GiB free-space floor';os.killpg(p.pid,signal.SIGTERM)
  try:p.wait(timeout=15)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
  break
 time.sleep(5)
code=p.wait();log.close();receipt=dict(host=platform.node(),platform=platform.platform(),binarySha256=expected,inputManifestSha256=hashlib.sha256((root/'inputs-manifest.json').read_bytes()).hexdigest(),waves=waves,workers=6,exit=code,diskGuard=guard,freeBytesBefore=free_before,freeBytesAfter=shutil.disk_usage(root).free,seconds=time.monotonic()-started)
(root/'remote-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
with tarfile.open(root/'results.tar.gz','w:gz')as archive:
 for name in ['out','remote-receipt.json','run-state.json','survey.log']:archive.add(root/name,arcname=name)
print(json.dumps(receipt),flush=True);sys.exit(code or int(bool(guard)))
