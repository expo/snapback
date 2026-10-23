import argparse, pathlib, shutil, subprocess, os, json, hashlib, tempfile, time
from concurrent.futures import ThreadPoolExecutor, as_completed
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--client-dir',required=True);p.add_argument('--out',required=True);p.add_argument('--lanes');p.add_argument('--legacy-expiry-fixture',action='store_true');a=p.parse_args()
out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True);apps=sorted((pathlib.Path.home()/'sb4-loop/wave23/apps').glob('*-snapback-*'));results=[]
if a.lanes:apps=[p for p in apps if p.name[:3]in a.lanes.split(',')]
env=dict(os.environ,SNAPBACK4_BIN=str(pathlib.Path(a.binary).resolve()),CI='1',EXPO_NO_TELEMETRY='1');env['PATH']=str(pathlib.Path(a.client_dir).resolve()/'node_modules/.bin')+':/tmp/integ23/acceptance-tools/node_modules/.bin:/home/ccheever/.bun-1.4.2/bin:'+env['PATH']
def one(src):
 manifest=json.loads((src/'package.json').read_text());script=next((src/'scripts').glob('acceptance.*'));before=hashlib.sha256(script.read_bytes()).hexdigest();start=time.monotonic()
 with tempfile.TemporaryDirectory(prefix='acceptance-w23-',dir=out) as scratch:
  root=pathlib.Path(scratch)
  for name in ['scripts','snapback','versions','v1','v2','rollback-v1','fixtures','src','shared','lib','tools','assets','tests','probe']:
   if (src/name).is_dir():shutil.copytree(src/name,root/name,ignore=shutil.ignore_patterns('node_modules','dist','.snapback4','*.sqlite*'))
  for name in ['package.json','tsconfig.json']:
   if (src/name).exists():shutil.copy2(src/name,root/name)
  fixture_patch=None
  if a.legacy_expiry_fixture and src.name[:3]in ['007','026','029']:
   name='scripts/harness.ts' if src.name[:3]in ['007','026'] else 'scripts/staging-helper.mjs'
   path=root/name;original=path.read_text();marker='  const stop=host.stop.bind(host);' if src.name[:3]=='026' else '  if (!host.sessions)'
   inserted="  const originalAdvance = host.advance.bind(host);\n  host.advance = (duration, options = {}) => originalAdvance(duration, {sessions: 'expire', ...options});\n"
   if src.name[:3]=='007':
    updated=original.replace('  return startServe(dir, { seedUsers: {','  const host = await startServe(dir, { seedUsers: {',1).replace('  } });\n}', '  } });\n'+inserted+'  return host;\n}',1)
    assert updated!=original;path.write_text(updated)
   else:
    assert marker in original;path.write_text(original.replace(marker,inserted+marker,1))
   import difflib
   patch=''.join(difflib.unified_diff(original.splitlines(True),path.read_text().splitlines(True),fromfile=name,tofile=name))
   (out/(src.name+'.fixture.patch')).write_text(patch);fixture_patch=name
  (root/'node_modules').mkdir()
  for entry in ((src/'node_modules').iterdir() if (src/'node_modules').exists() else []):
   if entry.name!='snapback4':(root/'node_modules'/entry.name).symlink_to(entry.resolve(),target_is_directory=entry.is_dir())
  (root/'node_modules/snapback4').symlink_to(pathlib.Path(a.client_dir).resolve()/'node_modules/snapback4',target_is_directory=True)
  generated=subprocess.run(['timeout','90s',env['SNAPBACK4_BIN'],'check','--json'],cwd=root,env=env,capture_output=True,text=True,timeout=100)
  (out/(src.name+'.check.json')).write_text(generated.stdout)
  (out/(src.name+'.check.stderr')).write_text(generated.stderr)
  assert (root/'snapback/generated/api.ts').exists(),generated.stderr
  config=json.loads((root/'tsconfig.json').read_text()) if (root/'tsconfig.json').exists() else {};config.pop('extends',None);(root/'acceptance-tsconfig.json').write_text(json.dumps(config));localenv=dict(env,TSX_TSCONFIG_PATH=str(root/'acceptance-tsconfig.json'),PORT_LO=str(32000+int(src.name[:3])*100),PORT_HI=str(32099+int(src.name[:3])*100))
  with (out/(src.name+'.log')).open('w') as log:r=subprocess.run(['timeout','900s','bun','run','acceptance'],cwd=root,env=localenv,stdout=log,stderr=subprocess.STDOUT,timeout=915)
 assert hashlib.sha256(script.read_bytes()).hexdigest()==before
 return dict(lane=src.name,exit=r.returncode,seconds=round(time.monotonic()-start,2),scriptSha256=before,unchanged=True,command=manifest['scripts']['acceptance'],explicitSessionExpiryFixture=fixture_patch,checkExit=generated.returncode)
with ThreadPoolExecutor(max_workers=4) as pool:
 for f in as_completed([pool.submit(one,src) for src in apps]):
  row=f.result();results.append(row);(out/'results.json').write_text(json.dumps(sorted(results,key=lambda x:x['lane']),indent=2));print(row,flush=True)
raise SystemExit(0 if len(results)==len(apps) and all(r['exit']==0 for r in results) else 1)
