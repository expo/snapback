import argparse,pathlib,tempfile,subprocess,json,shutil,hashlib
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--survey',required=True);p.add_argument('--out',required=True);a=p.parse_args();rows=json.loads(pathlib.Path(a.survey).read_text());results=[]
for row in rows:
 if row['variant']!='own' or row['exit']==0:continue
 wave,name=row['lane'].split('-',1);src=pathlib.Path.home()/f'sb4-loop/wave{wave[1:]}/apps'/name/'snapback'
 with tempfile.TemporaryDirectory(prefix='integ23-security-disposition-') as tmp:
  root=pathlib.Path(tmp);(root/'snapback').mkdir();hashes={}
  for f in src.glob('*.q'):
   shutil.copy2(f,root/'snapback'/f.name);hashes[f.name]=hashlib.sha256(f.read_bytes()).hexdigest()
  def run(args):
   r=subprocess.run(['timeout','45s',a.binary,'check',*args],cwd=root,capture_output=True,text=True)
   try:j=json.loads(r.stdout)
   except ValueError:j={}
   return r,j
  before,j=run(['--json']);notes=[n for n in j.get('securityReviews',[]) if n.get('gated') and not n.get('acknowledged')];acks=[]
  for note in notes:
   ack,_=run(['--ack-security',note['id'],'--reason','Integration corpus experiment: retained grant access after recipient role changes is explicitly acknowledged for this disposable copy; this review record grants no runtime authority and does not certify application intent.']);acks.append(ack.returncode)
  after,j2=run(['--json']);pending=[n for n in j2.get('securityReviews',[]) if n.get('gated') and not n.get('acknowledged')]
  results.append(dict(lane=row['lane'],before=before.returncode,notes=len(notes),codes=[n['code'] for n in notes],ackExits=acks,after=after.returncode,pendingAfter=len(pending),sourceHashes=hashes))
  pathlib.Path(a.out).write_text(json.dumps(results,indent=2))
  print(row['lane'],before.returncode,after.returncode,flush=True)
assert all(r['after']==0 and r['pendingAfter']==0 for r in results)
