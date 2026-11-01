#!/usr/bin/env python3
from pathlib import Path
import subprocess
k=Path('/home/ccheever/sb4-pub-0452-kit');w=Path('/home/ccheever/sb4-pub-0441')
source=(k/'source.sha').read_text().strip();stale=(k/'stale-draft-source.sha').read_text().strip()
old=(k/'mac-source.sha').read_text().strip() if (k/'mac-source.sha').exists() else stale
assert source==subprocess.check_output(['git','rev-parse','HEAD'],cwd=w,text=True).strip()
assert source!=stale and len(source)==40 and len(old)==40
changed=[]
for p in (k/'mac').rglob('*'):
 if not p.is_file() or p.suffix not in {'.sh','.py','.mjs','.json','.md'}:continue
 s=p.read_text();new=s.replace(stale,source).replace(stale[:10],source[:10]).replace(old,source).replace(old[:10],source[:10])
 if new!=s:p.write_text(new);changed.append(str(p.relative_to(k)))
print('Final Mac source assertions set from git-derived publication source:',source)
print('Updated files:',', '.join(changed))

(k/'mac-source.sha').write_text(source+'\n')
