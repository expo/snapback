"""Retain every repetition and the fixed source/artifact inventory; no retries."""
import hashlib,json,pathlib,subprocess,sys,time
root=pathlib.Path(__file__).resolve().parents[2];out=pathlib.Path(__file__).resolve().parent/'raw'
name,count=sys.argv[1],int(sys.argv[2]);command=sys.argv[3:]
def inputs():
 paths=subprocess.check_output(['git','ls-files','crates','packages','scripts','witness','fixtures','Cargo.toml','Cargo.lock','bun.lock'],cwd=root,text=True).splitlines()
 paths+=['packages/snapback4/src/wasm/snapback4_device_bg.wasm']
 paths+= [str(p.relative_to(root)) for p in (root/'packages/snapback4/dist').glob('*.js')]
 return {p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in paths if (root/p).is_file()}
before=inputs();rows=[]
(out/f'{name}-inputs.json').write_text(json.dumps(before,indent=2)+'\n')
for n in range(1,count+1):
 start=time.monotonic()
 with (out/f'{name}-{n:02}.log').open('w') as f:p=subprocess.run(command,cwd=root,stdout=f,stderr=subprocess.STDOUT)
 rows.append({'run':n,'exit':p.returncode,'seconds':time.monotonic()-start})
 (out/f'{name}.json').write_text(json.dumps({'command':command,'runs':rows},indent=2)+'\n')
 print(name,n,p.returncode,round(rows[-1]['seconds'],2),flush=True)
after=inputs();changed=sorted(p for p in before.keys()|after.keys() if before.get(p)!=after.get(p))
(out/f'{name}.json').write_text(json.dumps({'command':command,'runs':rows,'changedInputs':changed,'pass':not changed and all(r['exit']==0 for r in rows)},indent=2)+'\n')
sys.exit(int(bool(changed) or any(r['exit'] for r in rows)))
