"""Twenty repetitions of the two subprocess compiler-custody regressions."""
import hashlib, json, pathlib, subprocess, time
root = pathlib.Path.cwd()
out = root/'reports/20261007-fl-dry-run-flakes/round-6/evidence'
sources = ['scripts/test-owned-command.mjs','scripts/test-command-owner.mjs','scripts/test-command-group.mjs','scripts/test-signals.mjs','packages/snapback4/test/test-command-group.test.mjs']
hashes = lambda:{p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in sources}
before = hashes()
load, rounds = [], []
try:
    for _ in range(4):
        load.append(subprocess.Popen(['taskset','-c','80,81','python3','-c','import os,sys,threading; threading.Thread(target=lambda:(sys.stdin.read(),os._exit(0)),daemon=True).start()\nwhile True: pass'],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL))
    print(json.dumps({'cpus':'80,81','ownedLoadPids':[p.pid for p in load]}),flush=True)
    with (out/'loaded-groups.log').open('w') as log:
        for i in range(1,21):
            start = time.monotonic()
            result = subprocess.run(['taskset','-c','80,81','node','--test','--test-reporter=tap','--test-name-pattern=compiler timeout drains','packages/snapback4/test/test-command-group.test.mjs'],capture_output=True,text=True)
            row = {'round':i,'exit':result.returncode,'seconds':round(time.monotonic()-start,3)}
            rounds.append(row);print(json.dumps(row),flush=True)
            log.write(json.dumps(row)+'\n'+result.stdout+result.stderr);log.flush()
            assert result.returncode==0 and '# pass 2\n' in result.stdout,result.stdout+result.stderr
finally:
    for child in load: child.stdin.close()
    for child in load: child.wait()
    summary = {'cpus':'80,81','busyLoops':4,'sourceSha256':before,'sourceUnchanged':before==hashes(),'rounds':rounds,'loadReaped':all(p.poll() is not None for p in load)}
    (out/'loaded-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
assert len(rounds)==20 and summary['sourceUnchanged'] and summary['loadReaped']
