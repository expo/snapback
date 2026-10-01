"""Five isolated checkouts, with independent build caches and identical audited bytes."""
from pathlib import Path
import json,os,shutil,subprocess
report=Path(__file__).resolve().parent;root=report.parents[1];repo=root.parent
changed=subprocess.check_output(['git','diff','--name-only'],cwd=repo,text=True).splitlines()
records=[]
for n,cpus in enumerate(['0-9','10-19','20-29','30-39','86-95'],1):
 clone=repo.parent/f'wb-proof-{n}'
 assert not clone.exists(),clone
 subprocess.run(['git','-c','core.hooksPath=/dev/null','worktree','add','--detach',str(clone),'HEAD'],cwd=repo,check=True,stdout=subprocess.DEVNULL)
 for name in changed:
  target=clone/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(repo/name,target)
 helper=Path('snapback4/packages/snapback4/test/helpers/wait.mjs');shutil.copy2(repo/helper,clone/helper)
 for part in ['node_modules','target','packages/snapback4/dist','packages/snapback4/src/wasm']:
  source=root/part;target=clone/'snapback4'/part
  if target.exists():shutil.rmtree(target)
  subprocess.run(['cp','-a','--reflink=auto',str(source),str(target)],check=True)
 # Bun also installs per-app links; preserve their relative workspace layout.
 for path in root.glob('apps/*/node_modules'):
  target=clone/'snapback4'/path.relative_to(root)
  if target.exists():shutil.rmtree(target)
  subprocess.run(['cp','-a','--reflink=auto',str(path),str(target)],check=True)
 records.append(dict(name=f'heavy-{n}',root=str(clone/'snapback4'),cpus=cpus))
 (report/'runs.json').write_text(json.dumps(records,indent=2)+'\n')
 print('prepared',n,clone,flush=True)
