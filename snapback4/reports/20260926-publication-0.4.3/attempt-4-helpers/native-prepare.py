# Starts reports/20260926-expo-0.4.3/qualified.json after the xcframework build:
# source, source trees, version, framework file hashes and toolchain.
import pathlib,json,hashlib,subprocess,datetime
root=pathlib.Path.cwd(); artifacts=root/'reports/20260926-expo-0.4.3'; qpath=artifacts/'qualified.json'
assert not qpath.exists(), 'qualified.json already exists'
artifacts.mkdir(parents=True,exist_ok=True)
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
run=lambda *c:subprocess.check_output(list(c),text=True).strip()
assert run('git','status','--porcelain','--untracked-files=no')=='', 'tracked files differ from HEAD'
pkg=root/'packages/snapback4-expo'; version=json.loads((pkg/'package.json').read_text())['version']; assert version=='0.4.3'
fw=pkg/'ios/Snapback4Device.xcframework'; assert fw.is_dir()
q={'source':run('git','rev-parse','HEAD'),
   'sourceTrees':{c:run('git','rev-parse','HEAD:snapback4/crates/'+c) for c in ['snapback4-core','snapback4-device']},
   'version':version,'published':False,'qualification':'Framework rebuilt; Release app and native witness pending.',
   'xcframework':{str(p.relative_to(pkg)):digest(p) for p in sorted(fw.rglob('*')) if p.is_file()},
   'toolchain':{'node':run('node','--version'),'bun':run('bun','--version'),'rust':run('rustc','--version'),
                'xcode':run('xcodebuild','-version'),'os':run('sw_vers'),'cpu':run('sysctl','-n','machdep.cpu.brand_string')},
   'preparedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
qpath.write_text(json.dumps(q,indent=2)+'\n'); print(json.dumps({k:q[k] for k in ['source','sourceTrees','version']},indent=2)); print(len(q['xcframework']),'framework files hashed')
