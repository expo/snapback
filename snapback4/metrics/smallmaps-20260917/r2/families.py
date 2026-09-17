from pathlib import Path
import subprocess,json
root=Path.cwd(); repo=root.parent
paths=[Path(p) for p in subprocess.check_output(['git','diff','--name-only','70a663c22','--','snapback4/crates'],cwd=repo,text=True).splitlines() if '/src/' in p]
saved={p:(repo/p).read_bytes() if (repo/p).exists() else None for p in paths}
backup=root/'target/d2/r2/source-final'
for p,data in saved.items():
 if data is not None:q=backup/p;q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(data)
def read(p):return (root/'crates'/p).read_text()
def write(p,s):(root/'crates'/p).write_text(s)
def restore():
 for p,data in saved.items():
  if data is None:(repo/p).unlink(missing_ok=True)
  else:(repo/p).write_bytes(data)
def base(p):return subprocess.check_output(['git','show',f'70a663c22:snapback4/crates/{p}'],text=True,cwd=repo)
def g8_off():
 for p in ['snapback4-core/src/partition.rs','snapback4-core/src/wire.rs','snapback4-device/src/device/snapshot.rs']:
  s=read(p).replace('crate::smallmap::SmallMap','std::collections::BTreeMap').replace('SmallMap<String, BTreeSet<String>>','BTreeMap<String, BTreeSet<String>>');write(p,s)
 p='snapback4-device/src/device/history.rs';write(p,read(p).replace('Groups = SmallMap<','Groups = BTreeMap<'))
def g4_off():
 for p in ['snapback4-device/src/device.rs','snapback4-device/src/device/predictions.rs','snapback4-device/src/memory.rs','snapback4-device/src/sqlite.rs','snapback4-device/src/store.rs','snapback4-device/src/call.rs','snapback4-core/src/store/activation.rs']:
  s=read(p).replace('use snapback4_core::smallmap::SmallMap;','').replace('snapback4_core::smallmap::SmallMap','std::collections::BTreeMap').replace('crate::smallmap::SmallMap','std::collections::BTreeMap').replace('SmallMap','BTreeMap').replace('snapback4_core::ir::program_map(backend.programs)', 'backend.programs.into_iter().map(|p| (p.name.clone(), p)).collect()')
  if p.endswith('/store.rs') or p.endswith('/sqlite.rs'):s='use std::collections::BTreeMap;\n'+s if p.endswith('/sqlite.rs') else s.replace('use snapback4_core::schema::Schema;', 'use snapback4_core::schema::Schema;\nuse std::collections::BTreeMap;')
  write(p,s)
 # Device's asset-home program still names the IR argument-type map.
 p='snapback4-device/src/device/media.rs';write(p,read(p).replace('args: SmallMap::new()', 'args: snapback4_core::smallmap::SmallMap::new()'))
 for p in ['snapback4-core/src/engine/mod.rs','snapback4-core/src/engine/postgres/mod.rs']:
  s=read(p).replace('crate::smallmap::SmallMap','std::collections::BTreeMap').replace('crate::ir::program_map(programs.into_iter().collect())','programs.into_iter().map(|p| (p.name.clone(), p)).collect()');write(p,s)
def g3_off():
 for name in ['admission','pages','page_collectors','prefetch']:
  p=f'snapback4-core/src/engine/{name}.rs';s=base(p)
  if name=='page_collectors':s=s.replace('std::collections::BTreeMap<String, Expr>', 'crate::smallmap::SmallMap<String, Expr>')
  write(p,s)
try:
 for label,changes in [('r2-g4',[g8_off]),('r2-g3',[g8_off,g4_off]),('r2-g2',[g8_off,g4_off,g3_off])]:
  restore()
  for f in changes:f()
  (root/f'target/d2/r2/{label}.patch').write_bytes(subprocess.check_output(['git','diff','70a663c22','--','snapback4/crates'],cwd=repo))
  with (root/f'target/d2/r2/{label}.log').open('w') as log:
   result=subprocess.run(['bash','target/d2/measure.sh',label],stdout=log,stderr=subprocess.STDOUT)
  if result.returncode:raise RuntimeError(f'{label}: {result.returncode}')
  print(label,(root/f'target/d2/{label}/size.json').read_text(),flush=True)
finally:restore()
