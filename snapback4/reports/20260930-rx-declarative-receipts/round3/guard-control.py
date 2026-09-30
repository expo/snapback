from pathlib import Path
import subprocess,json,hashlib
root=Path('/home/ccheever/sb4-intent/lane-rx')
report=root/'snapback4/reports/20260930-rx-declarative-receipts/round3'
p=root/'snapback4/crates/snapback4-core/src/engine/receipts.rs'
original=p.read_bytes()
record={'before':hashlib.sha256(original).hexdigest()}
try:
 old='if self.device && !self.tx.current_group(&family.runs, index, &prefix)? {'
 assert old in original.decode()
 p.write_text(original.decode().replace(old,'if false && self.device && !self.tx.current_group(&family.runs, index, &prefix)? {'))
 command=['cargo','test','-p','snapback4-lang','--test','declarative_receipts','receipt_specific_coverage_guard','--','--nocapture']
 record['command']=command
 with (report/'guard-control.log').open('w') as log: record['exit']=subprocess.run(command,cwd=root/'snapback4',stdout=log,stderr=subprocess.STDOUT).returncode
finally:
 p.write_bytes(original)
 record['restored']=hashlib.sha256(p.read_bytes()).hexdigest()
 (report/'guard-control.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record))
