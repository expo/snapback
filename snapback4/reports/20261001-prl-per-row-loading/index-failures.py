"""Index retained failures, including historical controls and rejected candidates."""
from pathlib import Path
import json,re
report=Path(__file__).resolve().parent
entries=[]
for p in sorted(report.rglob('*.log')):
 text=p.read_text(errors='replace'); names=[]
 for line in text.splitlines():
  m=re.match(r'^(?:not ok \d+ - |✖ )(.+)$',line)
  if not m or m[1]=='failing tests:': continue
  name=re.sub(r' \([0-9.]+ms\)$','',m[1])
  if name not in names: names.append(name)
 if not names: continue
 category='baseline' if p.name.startswith(('bisect-','baseline-','final-causal-main')) else 'ours'
 entries.append({'log':str(p.relative_to(report)),'classification':category,'tests':names})
(report/'failures.json').write_text(json.dumps(entries,indent=2)+'\n')
print(len(entries),'failed logs;',sum(len(e['tests']) for e in entries),'test failures')
