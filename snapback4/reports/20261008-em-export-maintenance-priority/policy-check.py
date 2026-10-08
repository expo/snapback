#!/usr/bin/env python3
"""Compile the actual std-only policy module with debug assertions on and off."""
import hashlib,json,os,subprocess,tempfile
from pathlib import Path

os.umask(0o077)
report=Path(__file__).resolve().parent
workspace=report.parents[1]
source=workspace/'crates/snapback4/src/verbs/witness/export_policy.rs'
out=report/'evidence'
receipts=[]
with tempfile.TemporaryDirectory(prefix='round9-policy-',dir=workspace/'target/em') as directory:
    scratch=Path(directory)
    for mode in ['yes','no','negative-release']:
        text=source.read_text()
        if mode=='negative-release':
            body,tests=text.split('#[cfg(test)]',1)
            body=body.replace('cfg!(debug_assertions) && ','')
            body=body.replace('    #[cfg(debug_assertions)]\n','').replace('    #[cfg(not(debug_assertions))]\n    { false }\n','')
            text=body+'#[cfg(test)]'+tests
        module=scratch/(mode+'.rs');module.write_text(text)
        harness=scratch/'harness.rs';harness.write_text('#[path = '+json.dumps(str(module))+']\nmod export_policy;\n')
        binary=scratch/'policy-test'
        command=['rustc','--edition=2024','--test','-C','debug-assertions='+('yes' if mode=='yes' else 'no'),str(harness),'-o',str(binary)]
        build=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        assert build.returncode==0,build.stdout
        run=subprocess.run([str(binary),'--nocapture'],env={**os.environ,'SNAPBACK4_TEST_EXPORT_NORMAL_PRIORITY':'1'},stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        (out/f'policy-{mode}.log').write_bytes(build.stdout+run.stdout)
        receipt=dict(mode=mode,command=command,sourceSha256=hashlib.sha256(text.encode()).hexdigest(),
                     override='1',exitCode=run.returncode,expectedExit=101 if mode=='negative-release' else 0)
        receipts.append(receipt)
        assert run.returncode==receipt['expectedExit'],run.stdout
        if mode=='negative-release':
            import difflib
            (out/'policy-negative-release.diff').write_text(''.join(difflib.unified_diff(source.read_text().splitlines(True),text.splitlines(True),fromfile='fixed',tofile='release-gates-removed')))
    (out/'policy-check.json').write_text(json.dumps(receipts,indent=2)+'\n')
print('Debug and release policy checks passed; removed release gates fail with the fixture override set.')
