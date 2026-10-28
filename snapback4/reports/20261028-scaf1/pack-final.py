from pathlib import Path
import json,shutil,subprocess,hashlib,os
root=Path('/home/ccheever/projects/sb4-b33-tok1/snapback4');dst=Path('/tmp/scaf1-evidence/packs/measured-after');dst.mkdir(parents=True,exist_ok=True)
platform=dst/'platform';platform.mkdir(exist_ok=True)
for name in ['package.json','THIRD-PARTY-NOTICES']:shutil.copy2(root/'packages/snapback4-linux-x64'/name,platform/name)
shutil.copy2(root/'target/production/snapback4',platform/'snapback4')
for source in [root/'packages/snapback4',platform]:
 p=subprocess.run(['npm','pack','--ignore-scripts','--json','--pack-destination',str(dst)],cwd=source,check=True,stdout=subprocess.PIPE,text=True)
 print(p.stdout)
shutil.copy2('/tmp/scaf1-evidence/packs/optimized-before/snapback4-expo-0.4.46.tgz',dst/'snapback4-expo-0.4.46.tgz')
smoke=dst/'smoke';(smoke/'snapback').mkdir(parents=True,exist_ok=True)
(smoke/'snapback/schema.q').write_text("use identity password\ntable notes:\n  cap 10\n  body: text <=100\n  public 'Smoke'\n  online only\nquery all():\n  return notes\n")
r=subprocess.run([str(platform/'snapback4'),'check'],cwd=smoke,check=True,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
assert r.stdout.startswith('check: ok'),r.stdout
assert r.stdout.count('proof scaffold:')==1,r.stdout
assert (smoke/'scripts/proof-scaffold/acceptance.mjs').exists()
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
p=dict(source='1ccf620a0a (product), 8626bfb493 (ready review records)',profile='production (opt-level 3, fat LTO, one codegen unit, stripped)',target='x86_64-unknown-linux-gnu',rustc='1.97.0',binarySha256=sha(platform/'snapback4'),binaryBytes=(platform/'snapback4').stat().st_size,smoke=r.stdout,phase='final-after',packages=[dict(file=p.name,sha256=sha(p),bytes=p.stat().st_size)for p in sorted(dst.glob('*.tgz'))])
assert p['binarySha256']!='e5023d5b6d8e392c7f26f68b6195639c79ec78ce36f500f15b45f2a19f4290f0'
(dst/'provenance.json').write_text(json.dumps(p,indent=2)+'\n');print(json.dumps(p,indent=2))
