"""Read-only evidence input; independent temporary store-copy release flows."""
import argparse, json, pathlib, shutil, sqlite3, subprocess, tempfile, time
P=pathlib.Path
p=argparse.ArgumentParser();p.add_argument('--before',required=True);p.add_argument('--after',required=True);p.add_argument('--out',required=True);a=p.parse_args()
root=P('/home/ccheever/sb4-loop/wave21/apps')
friction=json.loads(P('/home/ccheever/sb4-loop/wave21-repro/friction/s_classified.json').read_text())
chosen={x['lane'] for x in friction if x['cl'] in ['REENTRY_INPUT','REENTRY_RENAMENULL','FORESIGHT']}
dormant={'013','020','032','035','037','038','040','042'}
chosen|={x.name for x in root.glob('*-snapback-*') if x.name[:3] in dormant}
results=[]
def invoke(binary,args,cwd):
 start=time.monotonic()
 try:
  r=subprocess.run([str(P(binary).resolve()),*map(str,args)],cwd=cwd,text=True,capture_output=True,timeout=90)
  item={'status':r.returncode,'seconds':round(time.monotonic()-start,2)}
  if r.returncode: item['error']=(r.stderr+'\n'+r.stdout)[:900]+'\n...\n'+(r.stderr+'\n'+r.stdout)[-900:]
  else:
   try:
    body=json.loads(r.stdout);item['json']={k:body[k] for k in ['visibility','rollbackForesight','backfills','release','generation','warnings','notes'] if k in body}
   except ValueError: item['message']=(r.stdout+r.stderr)[-500:]
  return item
 except subprocess.TimeoutExpired:return {'status':'timeout','seconds':round(time.monotonic()-start,2)}
for lane in sorted(chosen):
 entry={'lane':lane,'flows':{}}
 with tempfile.TemporaryDirectory(prefix='evol-w21-',dir=P(a.out).resolve().parent) as scratch:
  scratch=P(scratch);source=root/lane/'deploy'
  snapshot=scratch/'original.sqlite'
  with sqlite3.connect(f'file:{source/"store.sqlite"}?mode=ro',uri=True) as original,sqlite3.connect(snapshot) as dest:
   original.execute('PRAGMA query_only=ON');original.backup(dest)
  for label,binary in [('before',a.before),('after',a.after)]:
   cwd=scratch/label;deployment=cwd/'deployment';deployment.mkdir(parents=True)
   shutil.copytree(source/'releases',deployment/'releases',ignore=shutil.ignore_patterns('.snapback4'))
   shutil.copy2(snapshot,deployment/'store.sqlite')
   for name in ['current','releases.jsonl']:
    if (source/name).exists():shutil.copy2(source/name,deployment/name)
   # Deliberately omit credentials, owners, workers and asset bytes. These
   # source lanes have no fileText declaration; their media ledger is enough.
   flow=[]
   for cycle in range(2):
    for target in ['1','latest']:
     check=invoke(binary,['rollback',deployment,'--to',target,'--check','--json'],cwd)
     step={'cycle':cycle,'target':target,'check':check}
     if check['status']==0:step['activation']=invoke(binary,['rollback',deployment,'--to',target,'--json'],cwd)
     flow.append(step)
   entry['flows'][label]=flow
   if label=='after' and lane[:3] in dormant:
    # Return to newer source, then generate and actually preview the bridge.
    invoke(binary,['rollback',deployment,'--to','latest','--json'],cwd)
    bridge=cwd/'bridge'
    entry['bridgeGeneration']=invoke(binary,['rollback',deployment,'--to','1','--check','--bridge',bridge,'--json'],cwd)
    if entry['bridgeGeneration']['status']==0:
     entry['bridgePreview']=invoke(binary,['deploy',deployment,'--schema',bridge,'--restore-dormant','--check','--json'],cwd)
     if entry['bridgePreview']['status']==0:
      entry['bridgeActivation']=invoke(binary,['deploy',deployment,'--schema',bridge,'--restore-dormant','--json'],cwd)
 results.append(entry)
 P(a.out).write_text(json.dumps({'kind':'copied-final-store-release-flow','notes':'Final lane sources include builder workarounds; this is not a replay of deleted earlier failing source or the frontend proof. No original store, owner, session or credential is written. New-table population visibility is not a frozen-v1-query guarantee.','lanes':results},indent=2)+'\n')
 print(lane[:3],{label:sum(step['check']['status']!=0 or step.get('activation',{}).get('status',0)!=0 for step in flow) for label,flow in entry['flows'].items()},'bridge',entry.get('bridgePreview',{}).get('status'),flush=True)
