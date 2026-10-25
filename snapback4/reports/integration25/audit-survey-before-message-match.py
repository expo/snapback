from pathlib import Path
import json,gzip,tempfile,shutil,subprocess,concurrent.futures,os,hashlib,datetime
ROOT=Path('/home/ccheever/projects/snapback-sb4loop'); OUT=Path('/home/ccheever/sb4-loop/reports/integration25')
BIN=Path(os.environ['SURVEY_BIN']); label=os.environ.get('SURVEY_LABEL','merged')
prior=[json.loads(l) for l in gzip.decompress((ROOT/'snapback4/reports/integration24/write40/day-one-conditional-audit.jsonl.gz').read_bytes()).decode().splitlines()]
known={r['project']:r for r in prior}; rows=[json.loads(gzip.decompress(p.read_bytes())) for p in (OUT/f'survey-wave26-{label}').glob('w*.json.gz')]
bad=[r for r in rows if r['gates'] or any(r['calls'][c]['exit'] for c in ['freshDeploy','afterTestDeploy'])]
dest=OUT/f'survey-audit-{label}';dest.mkdir(exist_ok=True)
binding={'binary':str(BIN),'binarySha256':hashlib.sha256(BIN.read_bytes()).hexdigest(),'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True,timeout=10).strip(),'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'inheritedAuditSha256':hashlib.sha256((ROOT/'snapback4/reports/integration24/write40/day-one-conditional-audit.jsonl.gz').read_bytes()).hexdigest()}
(dest/'binding.json').write_text(json.dumps(binding,indent=2)+'\n')
if os.environ.get('AUDIT_ONLY'):
 prefixes=os.environ['AUDIT_ONLY'].split(',');bad=[r for r in bad if any(r['project'].startswith(p) for p in prefixes)]
def one(r):
 key=r['project']; old=known.get(key)
 if not old and key in ['w27-028-snapback-chandelier-restorations','w27-032-snapback-service-dog-placements']:
  old={'classification':'fixed fresh extraction source context','edits':[],'decisions':[]}
 if not old: return {'project':key,'classification':'manual audit required'}
 wave=r['wave']; name=key.split('-',1)[1]; source=Path.home()/f'sb4-loop/wave{wave}/apps'/name/'snapback'
 calls=[]
 with tempfile.TemporaryDirectory(prefix='integration25-audit-') as tmp:
  root=Path(tmp); (root/'snapback').mkdir()
  for q in source.glob('*.q'): shutil.copyfile(q,root/'snapback'/q.name)
  assert {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (root/'snapback').glob('*.q')}==r['sourceHashes']
  fixtures=source.parent/'fixtures'
  if fixtures.is_dir():shutil.copytree(fixtures,root/'fixtures',ignore=shutil.ignore_patterns('store.sqlite*','*-owner','*-token','node_modules'))
  def run(args):
   res=subprocess.run(['timeout','900s',str(BIN),*args],cwd=root,text=True,capture_output=True,timeout=915)
   calls.append({'argv':args,'exit':res.returncode,'stdout':res.stdout,'stderr':res.stderr})
   try:return json.loads(res.stdout)
   except:return {}
  for edit in old['edits']:
   if edit.get('operation')=='append':
    with (root/'snapback/schema.q').open('a') as f:f.write('\n'+edit['after']+'\n')
   else:
    before=edit['before']; found=False
    for q in (root/'snapback').glob('*.q'):
     text=q.read_text()
     if before in text:
      if text.count(before)>1:
       lines=text.splitlines(); pos=edit['site']['line']-1;assert lines[pos]==before;(lines.__setitem__(pos,edit['after']));text='\n'.join(lines)+'\n'
      else:text=text.replace(before,edit['after'],1)
      q.write_text(text);found=True;break
    assert found,(key,edit)
  checked=run(['check','--json'])
  if any(d['code']=='N_DERIVED_WRITE_AUTHORITY' for d in old['decisions']):
   run(['test']);checked=run(['check','--json'])
  applied=[]
  for decision in old['decisions']:
   site=decision['site'];site=f"{site['file']}:{site['line']}:{site['col']}" if isinstance(site,dict) else site
   matches=[g for g in checked.get('securityReviews',[]) if g['code']==decision['code'] and g['site']==site and (g.get('gated') or decision['code']=='N_DERIVED_WRITE_AUTHORITY') and not g.get('acknowledged')]
   assert len(matches)==1,(key,decision['code'],decision['site'],matches)
   args=['check','--ack-security',matches[0]['id'],'--reason',decision['argv'][-1]];run(args)
   applied.append({'code':decision['code'],'site':site,'id':matches[0]['id'],'argv':args,'exit':calls[-1]['exit']})
   checked=run(['check','--json'])
  checked=run(['check','--json']);ce=calls[-1]['exit']
  run(['deploy','fresh','--json']);fe=calls[-1]['exit']
  run(['test']);te=calls[-1]['exit']
  run(['deploy','after-test','--json']);ae=calls[-1]['exit']
  result={'project':key,'classification':old['classification'],'edits':old['edits'],'inheritedDecisions':old['decisions'],'decisions':applied,'checkExit':ce,'freshExit':fe,'testExit':te,'afterTestExit':ae,'remaining':[g for g in checked.get('securityReviews',[]) if g.get('gated') and not g.get('acknowledged')],'calls':calls}
  (dest/f'{key}.json.gz').write_bytes(gzip.compress(json.dumps(result).encode(),mtime=0));print(key,ce,fe,te,ae,flush=True);return result
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: results=list(pool.map(one,bad))
summary={'projects':len(rows),'audits':len(results),'unresolved':[r['project'] for r in results if r['classification']=='manual audit required' or any(r.get(k,1) for k in ['checkExit','freshExit','afterTestExit'])]}
assert binding['binarySha256']==hashlib.sha256(BIN.read_bytes()).hexdigest()
(dest/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary),flush=True)
