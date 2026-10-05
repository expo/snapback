"""Compare round-3 and round-4 pixel verdicts without modifying archived bytes.
Usage: python scan-archive.py <20261005-ni archive> <output.json>
Run from the repository root.
"""
import ast,json,sys,time,subprocess
from pathlib import Path
sys.path.insert(0,str(Path.cwd()/'benchmarks/native/0.4.0-native.1/driver'))
import evidence as e
source=subprocess.check_output(['git','show','ea8dc853ab:benchmarks/native/0.4.0-native.1/driver/evidence.py'],text=True)
oldglobals=dict(e.__dict__);node=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=='viewonce_pixels');exec(compile(ast.Module(body=[node],type_ignores=[]),'round3','exec'),oldglobals)
base=Path(sys.argv[1]);results=[];cache={}
for cold in sorted(base.rglob('cold-once.png')):
 if '/runs/' not in str(cold):continue
 root=cold.parent;frame=e.viewonce_frame(json.loads((root/'prime-once.json').read_text()));fixture=root/'viewonce-fixture.png'
 if not fixture.exists():fixture=Path('benchmarks/native/0.4.0-native.1/reference/once.png')
 key=(e.sha(root/'prime-once.png'),e.sha(cold),json.dumps(frame),e.sha(fixture));start=time.monotonic()
 if key not in cache:cache[key]=(oldglobals['viewonce_pixels'](root/'prime-once.png',cold,frame,fixture),e.viewonce_pixels(root/'prime-once.png',cold,frame,fixture))
 old,new=cache[key]
 r={'capture':str(cold.relative_to(base)),'inputs':{'prime':key[0],'cold':key[1],'fixture':key[3]},'round3':old,'round4':new,'changed':old[0]!=new[0],'wallSeconds':round(time.monotonic()-start,3)}
 results.append(r);print(json.dumps(r),flush=True)
Path(sys.argv[2]).write_text(json.dumps(results,indent=2)+'\n')
print('pairs',len(results),'unique',len(cache),'changed',sum(r['changed'] for r in results),flush=True)
