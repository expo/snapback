"""Stop only a validated owned survey tree; retain identity and cleanup receipts."""
import hashlib,json,os,pathlib,shutil,signal,sys,time
root=pathlib.Path(sys.argv[1]).resolve();assert str(root).startswith('/tmp/sec11b-item3-')or str(root).startswith('/tmp/sec11b-item4-');run=json.loads((root/'run-state.json').read_text());parent=run['pid'];expected=json.loads((root/'provenance.json').read_text())['binarySha256']
def table():
 result={}
 for p in pathlib.Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   f=(p/'stat').read_text().rsplit(')',1)[1].split();result[int(p.name)]=dict(ppid=int(f[1]),start=int(f[19]),state=f[0])
  except OSError:pass
 return result
before=table();known={};cases=set();binaries=set()
if parent in before:
 args=(pathlib.Path('/proc')/str(parent)/'cmdline').read_bytes().split(b'\0');assert len(args)>2 and pathlib.Path(args[1].decode())==root/'survey.py';assert b'--out'in args and pathlib.Path(args[args.index(b'--out')+1].decode())==root/'out'
 os.kill(parent,signal.SIGSTOP)
 for _ in range(5):
  t=table();owned={parent}
  while True:
   more=owned|{p for p,d in t.items()if d['ppid']in owned}
   if more==owned:break
   owned=more
  for pid in owned:
   if pid not in t:continue
   known[pid]=t[pid];proc=pathlib.Path('/proc')/str(pid)
   try:
    os.kill(pid,signal.SIGSTOP);cwd=(proc/'cwd').resolve()
    if cwd.parent==pathlib.Path('/tmp')and cwd.name.startswith('sb4-sec10-shipping-measure-')and(cwd/'snapback/schema.q').is_file():cases.add(cwd)
    cmd=(proc/'cmdline').read_bytes().split(b'\0');exe=pathlib.Path(cmd[0].decode())
    if exe.name=='snapback4'and exe.parent.parent==pathlib.Path('/tmp')and exe.parent.name.startswith('sb4-sec10-shipping-binary-')and hashlib.sha256(exe.read_bytes()).hexdigest()==expected:binaries.add(exe.parent)
   except(OSError,ProcessLookupError):pass
  time.sleep(.05)
 def matching(pid):return pid in table()and table()[pid]['start']==known[pid]['start']
 for sig in [signal.SIGTERM,signal.SIGCONT]:
  for pid in [p for p in known if p!=parent]+[parent]:
   if matching(pid):
    try:os.kill(pid,sig)
    except ProcessLookupError:pass
 for _ in range(30):
  t=table();remaining={p:d for p,d in known.items()if p in t and t[p]['start']==d['start']and t[p]['state']!='Z'}
  if not remaining:break
  time.sleep(.1)
 for pid in remaining:
  if matching(pid):
   try:os.kill(pid,signal.SIGKILL)
   except ProcessLookupError:pass
 time.sleep(.2)
t=table();remaining={p:t[p]for p,d in known.items()if p in t and t[p]['start']==d['start']and t[p]['state']!='Z'};assert not remaining,remaining
removed=[]
for path in cases|binaries:
 assert path.parent==pathlib.Path('/tmp')and not path.is_symlink()
 if path.exists():shutil.rmtree(path);removed.append(str(path))
record=dict(reason='Completed native800 composition does not require duplicate fleet attempts. In-flight unused attempts are interrupted, never PASS.',ownedIdentities=known,remainingLiveOwnedProcesses=remaining,removedOwnedTemporaryDirectories=removed,completedParentReceipt=(root/'remote-receipt.json').exists(),binarySha256=expected)
(root/'interruption-cleanup.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(dict(tracked=len(known),remaining=len(remaining),removed=len(removed))))
