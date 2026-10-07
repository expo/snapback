"""Twenty full dev_refusals runs plus signal/ownership regressions under load."""
import hashlib, json, os, pathlib, subprocess, time
root = pathlib.Path.cwd()
out = root/'reports/20261007-fl-dry-run-flakes/round-5/evidence'
sources = ['crates/snapback4/tests/dev_refusals.rs', 'scripts/test-signals.mjs', 'scripts/test-owned-command.mjs', 'scripts/test-processes.mjs', 'packages/snapback4/test/test-signals.test.mjs']
hashes = lambda: {p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in sources}
before = hashes()
env = {**os.environ,'LIBSQLITE3_FLAGS':'-USQLITE_ENABLE_MEMORY_MANAGEMENT','CARGO_BUILD_JOBS':'6'}
built = subprocess.run(['cargo','test','-p','snapback4','--test','dev_refusals','--no-run','--message-format=json'],env=env,capture_output=True,text=True)
assert built.returncode==0,built.stderr
binary = next(row['executable'] for line in built.stdout.splitlines() if line.startswith('{') for row in [json.loads(line)] if row.get('reason')=='compiler-artifact' and row.get('target',{}).get('name')=='dev_refusals' and row.get('executable'))
rounds, load = [], []
try:
    for _ in range(4):
        load.append(subprocess.Popen(['taskset','-c','80,81','python3','-c','import os,sys,threading; threading.Thread(target=lambda:(sys.stdin.read(),os._exit(0)),daemon=True).start()\nwhile True: pass'],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL))
    print(json.dumps({'cpus':'80,81','ownedLoadPids':[p.pid for p in load]}),flush=True)
    with (out/'loaded-tests.log').open('w') as log:
        for i in range(1,21):
            start = time.monotonic()
            rust = subprocess.run(['taskset','-c','80,81',binary],capture_output=True,text=True)
            log.write(f'ROUND {i} dev_refusals\n'+rust.stdout+rust.stderr);log.flush()
            assert rust.returncode==0 and '22 passed; 0 failed' in rust.stdout,rust.stdout+rust.stderr
            node = subprocess.run(['taskset','-c','80,81','node','--test','--test-reporter=tap','--test-name-pattern=tracked identity accepts|owned shebang timeout|owned cleanup refuses|self-directed cleanup|publisher (before|after) barrier|every external test signal','packages/snapback4/test/test-signals.test.mjs','packages/snapback4/test/export-publication.test.mjs','packages/snapback4/test/test-processes.test.mjs'],capture_output=True,text=True)
            log.write(f'ROUND {i} helpers\n'+node.stdout+node.stderr);log.flush()
            assert node.returncode==0 and '# pass 10\n' in node.stdout,node.stdout+node.stderr
            row = {'round':i,'rustPassed':22,'nodePassed':10,'seconds':round(time.monotonic()-start,3)}
            rounds.append(row);print(json.dumps(row),flush=True)
finally:
    for child in load: child.stdin.close()
    for child in load: child.wait()
    summary = {'cpus':'80,81','busyLoops':4,'sourceSha256':before,'sourceUnchanged':before==hashes(),'rounds':rounds,'loadReaped':all(p.poll() is not None for p in load)}
    (out/'loaded-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
assert len(rounds)==20 and summary['sourceUnchanged'] and summary['loadReaped']
