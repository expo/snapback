from pathlib import Path
import subprocess,shutil,json,sys,hashlib
# Reuse the byte-probe definitions without executing their main loop.
exec(Path('target/d2/r2/families.py').read_text().split('\ntry:\n')[0])
def g2_off():
 for p in ['snapback4-core/src/schema.rs','snapback4-core/src/schema/work.rs','snapback4-core/src/schema/routes.rs']:
  write(p,base(p))
 p='snapback4-core/src/ir.rs'
 helper=read(p).split('/// Index an installed backend once;')[1].split('\n#[derive(Clone, Copy')[0]
 old=base(p).replace('use std::collections::BTreeMap;', 'use std::collections::BTreeMap;\nuse crate::smallmap::SmallMap;')
 at=old.index('\n#[derive(Clone, Copy',old.index('pub struct Program'))
 write(p,old[:at]+'\n/// Index an installed backend once;'+helper+old[at:])
 p='snapback4-core/src/engine/page_collectors.rs';write(p,read(p).replace('crate::smallmap::SmallMap<String, Expr>', 'std::collections::BTreeMap<String, Expr>'))
 p='snapback4-lang/src/bind/residency.rs';write(p,read(p).replace('snapback4_core::smallmap::SmallMap<String, Execution>', 'std::collections::BTreeMap<String, Execution>'))
 p='snapback4-device/src/device/media.rs';write(p,read(p).replace('args: SmallMap::new()', 'args: BTreeMap::new()'))
label=sys.argv[1]
changes={'no-g2':[g2_off], 'no-g3':[g3_off], 'g2-only':[g8_off,g4_off,g3_off], 'no-g4':[g8_off,g4_off], 'no-g8':[g8_off]}
try:
 for f in changes[label]:f()
 (root/f'target/d2/r2/{label}.patch').write_bytes(subprocess.check_output(['git','diff','70a663c22','--','snapback4/crates'],cwd=repo))
 with (root/f'target/d2/r2/build-{label}.jsonl').open('w') as log,(root/f'target/d2/r2/build-{label}.log').open('w') as err:
  subprocess.run(['cargo','test','-p','snapback4-sim','--test','clique','--no-run','--message-format=json'],stdout=log,stderr=err,check=True)
 directory=root/'target/d2/r2'/label;directory.mkdir(exist_ok=True)
 for line in (root/f'target/d2/r2/build-{label}.jsonl').read_text().splitlines():
  try:m=json.loads(line)
  except:continue
  if m.get('executable') and m['target']['name']=='clique':shutil.copy2(m['executable'],directory/'clique')
 (directory/'sha256.txt').write_text(hashlib.sha256((directory/'clique').read_bytes()).hexdigest()+'\n')
 print('built',label,flush=True)
finally:restore()
