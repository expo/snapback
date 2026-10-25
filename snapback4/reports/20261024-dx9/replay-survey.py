import concurrent.futures,gzip,hashlib,json,os,shutil,statistics,subprocess,time
from pathlib import Path
root=Path(__file__).resolve().parents[3];binary=root/'snapback4/target/debug/snapback4'
base=Path('/home/ccheever/sb4-loop/wave26-repro');scratch=Path('/tmp/dx9-replay/survey');scratch.mkdir(parents=True,exist_ok=True)
report=root/'snapback4/reports/20261024-dx9'
def lane(n):
 name=f'{n:03}';target=scratch/name;target.mkdir(exist_ok=True);(target/'snapback').mkdir(exist_ok=True)
 source=base/'friction/notes'/name/'snapback'
 for q in source.glob('*.q'):shutil.copy2(q,target/'snapback'/q.name)
 out={"lane":name,"sourceSha256":hashlib.sha256(b''.join(p.read_bytes() for p in sorted(source.glob('*.q')))).hexdigest(),"commands":["snapback4 check --json","snapback4 check"]}
 try:
  result=subprocess.run(['timeout','30s',str(binary),'check','--json'],cwd=target,capture_output=True,text=True,timeout=35)
  new=json.JSONDecoder().raw_decode(result.stdout)[0];old=json.JSONDecoder().raw_decode(gzip.decompress((base/'gates/out'/f'{name}.c40.json.gz').read_bytes()).decode())[0]
  human=subprocess.run(['timeout','30s',str(binary),'check'],cwd=target,capture_output=True,text=True,timeout=35)
  before=(base/'gates/out'/f'{name}.c40.txt').read_text()
  notes=new.get('security',{}).get('notes',[]);oldnotes=old.get('security',{}).get('notes',[])
  gates=[r for r in new.get('securityReviews',[]) if r.get('gated') and not r.get('acknowledged')]
  out.update(exit=result.returncode,humanExit=human.returncode,notes=len(notes),oldNotes=len(oldnotes),pendingGates=len(gates),gateCodes=sorted({r['code'] for r in gates}),deadlineNotes=[r['code'] for r in notes if 'SWEEP' in r['code']]+[r['code'] for r in new.get('notes',[]) if 'SWEEP' in r['code']],oldDeadlineNotes=[r['code'] for r in oldnotes+old.get('notes',[]) if 'SWEEP' in r['code']],oldChars=len(before),newChars=len(human.stdout+human.stderr),summary=[l for l in human.stdout.splitlines() if l.startswith('check:')],familyMembers=sum(bool(r.get('family')) for r in new.get('securityReviews',[])))
 except Exception as e:out['error']=type(e).__name__+': '+str(e)[:200]
 return out
try:
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: rows=list(pool.map(lane,range(1,51)))
 summary={"binarySha256":hashlib.sha256(binary.read_bytes()).hexdigest(),"lanes":len(rows),"checkPass":sum(r.get('exit')==0 for r in rows),"pendingGates":sum(r.get('pendingGates',0) for r in rows),"oldCharsMedian":statistics.median([r['oldChars'] for r in rows if 'oldChars' in r] or [0]),"newCharsMedian":statistics.median([r['newChars'] for r in rows if 'newChars' in r] or [0]),"rows":rows}
 (report/'wave26-survey.json').write_text(json.dumps(summary,indent=2)+'\n')
 print(json.dumps({k:v for k,v in summary.items() if k!='rows'}))
finally:shutil.rmtree(scratch,ignore_errors=True)
