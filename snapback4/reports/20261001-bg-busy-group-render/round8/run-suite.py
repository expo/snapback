from pathlib import Path
import subprocess, os, json, hashlib, datetime, platform
root=Path(__file__).resolve().parents[3];repo=root.parent
report=root/'reports/20261001-bg-busy-group-render/round8'
assert not (report/'full-suite.log').exists() and not (report/'full-suite.exit').exists(), 'full suite is once-only on this final source'
env={**os.environ,'LIBSQLITE3_FLAGS':'-USQLITE_ENABLE_MEMORY_MANAGEMENT'}
paths=set(json.loads((report.parent/'round7/final-source.json').read_text())['files'])
paths.update(subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','snapback4/crates','snapback4/packages','snapback4/scripts'],cwd=repo,text=True).splitlines())
files={path:hashlib.sha256((repo/path).read_bytes()).hexdigest() for path in sorted(paths) if (repo/path).is_file()}
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
(report/'final-source.json').write_text(json.dumps({'captured':datetime.datetime.now(datetime.timezone.utc).isoformat(),'head':head,'files':files},indent=2)+'\n')
def wasm():
    path=root/'packages/snapback4/src/wasm/snapback4_device_bg.wasm'
    return {'raw_bytes':path.stat().st_size,'gzip_bytes':len(subprocess.check_output(['gzip','-9','-c',str(path)])),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
before=wasm()
prior=json.loads((report.parent/'round7/wasm.json').read_text())['candidate']
(report/'wasm.json').write_text(json.dumps({'candidate':before,'round7':prior,'branch_ratchet':605225,'gzip_method':'gzip -9 -c FILE'},indent=2)+'\n')
versions={name:subprocess.check_output(cmd,text=True).strip() for name,cmd in [('rustc',['rustc','-vV']),('node',['node','--version']),('bun',['bun','--version']),('wasm_bindgen',['wasm-bindgen','--version'])]}
versions.update({'platform':platform.platform(),'affinity_cpus':len(os.sched_getaffinity(0)),'env':{'LIBSQLITE3_FLAGS':env['LIBSQLITE3_FLAGS']}})
(report/'toolchain.json').write_text(json.dumps(versions,indent=2)+'\n')
print('START full-suite',flush=True)
with (report/'full-suite.log').open('w') as out:
    result=subprocess.run(['bash','scripts/test.sh'],cwd=root,env=env,stdout=out,stderr=subprocess.STDOUT)
(report/'full-suite.exit').write_text(str(result.returncode)+'\n')
log=(report/'full-suite.log').read_text()
summary=[line for line in log.splitlines() if line.startswith('== ') and 'failure(s) in' in line]
changed=[p for p,digest in files.items() if not (repo/p).exists() or hashlib.sha256((repo/p).read_bytes()).hexdigest()!=digest]
receipt={'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'suite_exit':result.returncode,'suite_summary':summary,
'suite_log_sha256':hashlib.sha256((report/'full-suite.log').read_bytes()).hexdigest(),'captured_source_files':len(files),'source_changes':changed,
'wasm':wasm(),'wasm_identical_to_measurement':wasm()==before,'failed_steps':[line for line in log.splitlines() if line.startswith('-- FAIL:')]}
(report/'final-verification.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt,indent=2),flush=True)
raise SystemExit(result.returncode or bool(changed))
