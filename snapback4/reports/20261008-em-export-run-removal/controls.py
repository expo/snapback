#!/usr/bin/env python3
"""Restore each product fix to its old behavior, retaining the debug barriers."""
import difflib,gzip,hashlib,json,os,shutil,subprocess,time
from pathlib import Path
workspace=Path(__file__).resolve().parents[2]
os.chdir(workspace)
out=Path(__file__).resolve().parent
os.umask(0o077)
env={**os.environ,'LIBSQLITE3_FLAGS':'-USQLITE_ENABLE_MEMORY_MANAGEMENT','CARGO_BUILD_JOBS':'6'}
files=[Path(p) for p in ['crates/snapback4/src/verbs/witness/retention.rs','crates/snapback4/src/verbs/witness/recovery.rs','packages/snapback4-expo/export-ios.mjs']]
saved={p:p.read_text() for p in files}
records=[]
def run(name,cmd,more=None):
    started=time.monotonic()
    with (out/(name+'.log')).open('w') as log:
        status=subprocess.run(cmd,env={**env,**(more or {})},stdout=log,stderr=subprocess.STDOUT).returncode
    record=dict(name=name,command=cmd,exitCode=status,seconds=time.monotonic()-started)
    records.append(record);(out/'controls.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps(record),flush=True)
    return status

def pin(name):
    binary=workspace/f'target/{name}/debug/snapback4';binary.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2('target/debug/snapback4',binary)
    (out/(name+'-binary.json')).write_text(json.dumps(dict(path=str(binary),sha256=hashlib.sha256(binary.read_bytes()).hexdigest()),indent=2)+'\n')
    return str(binary)
pin('em-r11-final')
try:
    p=files[0];s=saved[p];old='OpenOptions::new().read(true).write(true).open(dir.join(name))';assert s.count(old)==1;p.write_text(s.replace(old,'OpenOptions::new().create(true).read(true).write(true).truncate(false).open(dir.join(name))'))
    p=files[1];s=saved[p];start=s.index('            // A failed wrapper can remove this discovery');end=s.index('            let Ok(_run)',start);p.write_text(s[:start]+s[end:])
    assert run('build-negative',['cargo','build','-p','snapback4'])==0
    mutant=pin('em-r11-negative')
    p=files[2];s=saved[p];old="        initialization ??= acquireExportLease(root, 'snapback4', true);\n";assert s.count(old)==1;p.write_text(s.replace(old,''))
    with gzip.open(out/'negative-control.diff.gz','wt') as diff:
        for p in files:diff.writelines(difflib.unified_diff(saved[p].splitlines(True),p.read_text().splitlines(True),fromfile=str(p),tofile=str(p)))
    status=run('negative-controls',['node','--test','--test-name-pattern=failed export removal|shell repair cannot','packages/snapback4/test/export-background.test.mjs'],{'SNAPBACK4_EXPORT_TEST_BINARY':mutant,'SNAPBACK4_MAINTENANCE_EVIDENCE':str(out/'negative-snapshots')})
    log=(out/'negative-controls.log').read_text()
    assert status==1 and 'ENOTEMPTY' in log and 'run.lock' in log and 'export.lock' in log and 'already removed discoveries must not be recreated' in log
finally:
    for p,s in saved.items():p.write_text(s)
    assert run('build-final',['cargo','build','-p','snapback4'])==0
    pin('em-r11-final')
