from pathlib import Path
import subprocess, hashlib, json
root=Path('/home/ccheever/sb4-intent/lane-rx')
report=root/'snapback4/reports/20260930-rx-declarative-receipts/round3'
files=['snapback4/crates/snapback4-lang/src/bind/'+p for p in ['mod.rs','program/expr.rs','program/control.rs','receipts.q','receipts.rs']]
backup={p:(root/p).read_bytes() for p in files}
record={'base':'eb465eec419cc43db6ed67b3132596733ea7cc65','before':{p:hashlib.sha256(b).hexdigest() for p,b in backup.items()}}
try:
 for p in files: (root/p).write_bytes(subprocess.check_output(['git','show',record['base']+':'+p],cwd=root))
 command=['cargo','test','-p','snapback4-lang','--test','declarative_receipts','round3','--','--nocapture']
 record['command']=command
 with (report/'round2-controls.log').open('w') as log: record['exit']=subprocess.run(command,cwd=root/'snapback4',stdout=log,stderr=subprocess.STDOUT).returncode
finally:
 for p,b in backup.items(): (root/p).write_bytes(b)
 record['restored']={p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in files}
 (report/'round2-controls.json').write_text(json.dumps(record,indent=2)+'\n')
assert record['restored']==record['before']
print(json.dumps({'exit':record['exit'],'restored':True}))
