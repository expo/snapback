from pathlib import Path
import subprocess,json,shutil,hashlib
root=Path.cwd();repo=root.parent;out=root/'target/d2/r2';base='70a663c22285dc3a5278ca9ac13db01bbe05446b'
paths=[Path(p) for p in subprocess.check_output(['git','diff','--name-only',base,'--','snapback4/crates'],cwd=repo,text=True).splitlines()]
saved={p:(repo/p).read_bytes() if (repo/p).exists() else None for p in paths}
fixture=Path('snapback4/crates/snapback4-sim/tests/common/following_app.rs')
# Identical measurement-only instrumentation on both sources.
def instrument(s):
 s=s.replace('let mut last = None;\n    for n in 0..23', 'let mut last = None;\n    let mut first_ms = 0.0;\n    for n in 0..23')
 s=s.replace('if n >= 3 { times.push(start.elapsed().as_secs_f64() * 1000.0); }', 'let elapsed = start.elapsed().as_secs_f64() * 1000.0;\n        if n == 0 { first_ms = elapsed; }\n        if n >= 3 { times.push(elapsed); }')
 s=s.replace('index={} p95_ms={:.3}", page.metered.examined, page.metered.rule_probes, page.metered.index_entries, times[18]', 'index={} first_ms={first_ms:.3} p50_ms={:.3} p95_ms={:.3}", page.metered.examined, page.metered.rule_probes, page.metered.index_entries, times[10], times[18]')
 return s
identities={}
def build(stage):
 command=['cargo','test','-p','snapback4-sim','--test','clique','-p','snapback4-device','--test','device','--no-run','--message-format=json']
 with (out/f'build-{stage}.jsonl').open('w') as log,(out/f'build-{stage}.log').open('w') as err:
  subprocess.run(command,stdout=log,stderr=err,check=True)
 directory=out/stage;directory.mkdir(exist_ok=True)
 for line in (out/f'build-{stage}.jsonl').read_text().splitlines():
  try:m=json.loads(line)
  except:continue
  if m.get('executable') and m['target']['name'] in ['clique','device']:
   path=directory/m['target']['name'];shutil.copy2(m['executable'],path);identities[f'{stage}/{path.name}']=hashlib.sha256(path.read_bytes()).hexdigest()
 print('built',stage,flush=True)
try:
 for p in paths:
  r=subprocess.run(['git','show',f'{base}:{p}'],cwd=repo,capture_output=True)
  if r.returncode==0:(repo/p).write_bytes(r.stdout)
  elif (repo/p).exists():(repo/p).unlink()
 (repo/fixture).write_text(instrument((repo/fixture).read_text()))
 build('before')
finally:
 for p,data in saved.items():
  if data is None:(repo/p).unlink(missing_ok=True)
  else:(repo/p).parent.mkdir(parents=True,exist_ok=True);(repo/p).write_bytes(data)
build('after')
(out/'pair-identities.json').write_text(json.dumps({'baseline':base,'checkpoint':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'sha256':identities},indent=2)+'\n')
