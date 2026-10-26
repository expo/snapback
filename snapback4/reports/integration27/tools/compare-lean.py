import json,hashlib
from pathlib import Path
OLD=Path('/home/ccheever/sb4-loop/reports/integration26/inherited-lean-baseline')
NEW=Path('/home/ccheever/projects/snapback-sb4loop/snapback4/target/affected/difftest-run-lean')
OUT=Path('/home/ccheever/sb4-loop/reports/integration27')
files=lambda p:{str(f.relative_to(p)):hashlib.sha256(f.read_bytes()).hexdigest() for f in p.rglob('*') if f.is_file() and f.name in ['case.q','case.json']}
a,b=files(OLD),files(NEW)
old=json.loads((OLD/'report.json').read_text());new=json.loads((NEW/'report.json').read_text())
d={'sameFindings':a==b,'findingFiles':len(b),'sameOracleTotals':old['by_oracle']==new['by_oracle'],'before':old['by_oracle'],'after':new['by_oracle'],'newFiles':sorted(b.keys()-a.keys()),'missingFiles':sorted(a.keys()-b.keys()),'changedFiles':[f for f in a.keys()&b.keys() if a[f]!=b[f]],'findingSha256':b,'comparison':'All sixteen reproducer source/JSON files byte-for-byte, plus complete by_oracle totals; nondeterministic worker runtime logs are retained separately and do not encode findings.'}
(OUT/'lean-baseline-comparison.json').write_text(json.dumps(d,indent=2)+'\n')
assert d['sameFindings'] and d['sameOracleTotals'],d
print(json.dumps(d,indent=2))
