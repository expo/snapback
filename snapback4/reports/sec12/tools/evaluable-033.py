import pathlib,subprocess,json,shutil,time,concurrent.futures,sys
base=pathlib.Path('/home/ccheever/sb4-loop/reports/sec12');source=pathlib.Path('/home/ccheever/sb4-loop/wave31/apps/033-snapback-garage-floor-coatings/snapback');out=pathlib.Path(sys.argv[2])if len(sys.argv)>2 else base/'evaluable-033';out.mkdir(exist_ok=True)
original=json.loads((source/'security-reviews.json').read_text());reason=next(x['reason']for x in original['entries'].values()if'damp approval'in x['reason'])
def measure(label,binary):
 root=out/label;(root/'snapback').mkdir(parents=True,exist_ok=True)
 for q in source.glob('*.q'):shutil.copy2(q,root/'snapback'/q.name)
 def run(name,args):
  start=time.monotonic();r=subprocess.run(['timeout','--kill-after=5s','900s',binary,*args],cwd=root,capture_output=True,text=True);(root/(name+'.stdout')).write_text(r.stdout);(root/(name+'.stderr')).write_text(r.stderr)
  try:j=json.loads(r.stdout)
  except:j={}
  return r,j,round(time.monotonic()-start,2)
 r,j,elapsed=run('check',['check','--json']);gate=next(d for d in j['securityReviews']if d['code']=='N_APPROVAL_NOT_ENFORCED'and d.get('witness')and d['witness']['row'].get('dampSigned')==True and d['witness']['row'].get('dampApproved')==False)
 witness=gate['witness'];digest=witness['id'];prose='witness '+digest+';'+reason.split(';',1)[1]
 r,j,s=run('prose',['check','--json','--ack-security',gate['id'],'--reason',prose]);rows=[dict(step='current-digest original false-premise prose',exit=r.returncode,seconds=s,acknowledged=any(d['id']==gate['id']and d['acknowledged']for d in j.get('securityReviews',[])))]
 if label=='new':
  assert not rows[-1]['acknowledged'] and r.returncode!=0
  for name,intent in [('false-invariant','invariant jobs.advanceJob only not .dampSigned or .dampApproved'),('explicit-allowance','allow jobs.advanceJob when true')]:
   r,j,s=run(name,['check','--json','--ack-security',gate['id'],'--reason',f'witness {digest}; {intent}']);acks=[d for d in j.get('securityReviews',[])if d['id']==gate['id']];acked=any(d['acknowledged']for d in acks);rows.append(dict(step=name,intent=intent,exit=r.returncode,seconds=s,acknowledged=acked,evaluations=[d.get('witness',{}).get('intentAnswers')for d in acks]));assert acked==(name=='explicit-allowance'),rows
  r,j,s=run('audit',['audit','--json']);rows.append(dict(step='audit-rechecks',exit=r.returncode,seconds=s,acknowledged=any(d['id']==gate['id']and d['acknowledged']for d in j.get('securityReviews',[]))));assert rows[-1]['acknowledged']
 else:assert rows[-1]['acknowledged'],rows
 return dict(binary=binary,gate=gate['id'],witness=digest,operation=witness['operation'],truth={k:witness['row'][k]for k in ['dampSigned','dampApproved']},checkSeconds=elapsed,steps=rows)
with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:results=list(pool.map(lambda x:measure(*x),[('before','/home/ccheever/sb4-loop/reports/sec11/snapback4-committed'),('new',sys.argv[1])]))
(out/'summary.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2))
