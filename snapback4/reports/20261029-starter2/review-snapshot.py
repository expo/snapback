import subprocess,pathlib,shutil,json,hashlib,sys
root=pathlib.Path.cwd();out=pathlib.Path(sys.argv[1]);out.mkdir(exist_ok=True)
paths=subprocess.check_output(['git','diff','--name-only','origin/main'],text=True).splitlines()+subprocess.check_output(['git','ls-files','--others','--exclude-standard'],text=True).splitlines()
paths=sorted(set(p for p in paths if (p.startswith('snapback4/') and '/reports/' not in p) or p.startswith('llp/3000.037.000-')))
for p in paths:
 target=out/'after'/p;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(root/p,target)
 before=subprocess.run(['git','show','origin/main:'+p],capture_output=True)
 if before.returncode==0:
  target=out/'before'/p;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(before.stdout)
for p in ['snapback4/packages/snapback4/src/contract.ts','snapback4/crates/snapback4/src/verbs/init/proof_advice.rs','snapback4/crates/snapback4/src/verbs/init/verify-parent.mjs']:
 target=out/'context'/p;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(root/p,target)
(out/'changes.diff').write_bytes(subprocess.check_output(['git','diff','origin/main','--',*paths]))
(out/'files.json').write_text(json.dumps(paths,indent=2))
manifest={str(p.relative_to(out)):hashlib.sha256(p.read_bytes()).hexdigest() for folder in ['before','after','context'] for p in sorted((out/folder).rglob('*')) if p.is_file()}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2))
