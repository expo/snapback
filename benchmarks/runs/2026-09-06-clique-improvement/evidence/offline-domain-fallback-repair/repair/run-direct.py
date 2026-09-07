from pathlib import Path
import datetime, hashlib, json, subprocess, time

O = Path(__file__).parent
D = O / 'direct-probe'
bun = Path('/Users/ccheever/.bun/bin/bun')
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
runtime_sha = sha(bun)
assert runtime_sha == '39e644cea4e6db24a3af36013695655d6f789b4b98f1f13bacb882ac6e5c3c18'
version = subprocess.check_output([str(bun), '--version'], timeout=10, text=True).strip()
assert version == '1.3.12'
sources = json.loads((D / 'sources.json').read_text())
def verify():
    for row in sources['files']:
        assert sha(row['copy']) == row['sha256']
    assert sha(D / 'probe.ts') == sources['probeSha256'] == '1132b7fa195098e8c1aebbd6c803e31c44dec1130b2d8220d4efad54544a9e1f'
    assert sha(bun) == runtime_sha
verify()
argv = [str(bun), str(D / 'probe.ts')]
start = datetime.datetime.now(datetime.timezone.utc).isoformat()
clock = time.monotonic()
with (D / 'stdout.json').open('xb') as out, (D / 'stderr.log').open('xb') as err:
    p = subprocess.Popen(argv, cwd=D, stdout=out, stderr=err)
    launch = dict(startedUtc=start, pid=p.pid, argv=argv, cwd=str(D), timeoutSeconds=10,
                  runtimeVersion=version, runtimeSha256=runtime_sha, sourcesSha256=sha(D / 'sources.json'),
                  probeSha256=sha(D / 'probe.ts'))
    (D / 'launch.json').write_text(json.dumps(launch, indent=2) + '\n')
    timed_out = False
    try:
        status = p.wait(timeout=10)
    except subprocess.TimeoutExpired:
        timed_out = True
        p.kill()
        status = p.wait()
execution = dict(launch, endedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                 elapsedSeconds=time.monotonic()-clock, exitCode=status, timedOut=timed_out,
                 stdoutSha256=sha(D / 'stdout.json'), stderrSha256=sha(D / 'stderr.log'),
                 supervision='Python wait(timeout=10); only recorded child PID killed on timeout')
(D / 'execution.json').write_text(json.dumps(execution, indent=2) + '\n')
verify()
assert status == 0 and not timed_out
old = json.loads((O / 'closed-review/domain-fallback/stdout.json').read_text())
new = json.loads((D / 'stdout.json').read_text())
assert new['scope'] == old['scope'] and len(new['results']) == len(old['results']) == 5
checks = []
for before, after in zip(old['results'], new['results']):
    assert before['name'] == after['name'] and before['input'] == after['input']
    assert before['parent'] == after['parent'] == after['candidate'] and after['equal'] is True
    if 'value' in after['candidate']:
        assert hashlib.sha256(after['candidate']['value'].encode()).hexdigest() == after['candidate']['sha256']
    checks.append(dict(name=after['name'], originalInputEqual=True, fullParentAndRepairResultEqual=True,
                       fixedParentOracleEqual=True, originalCandidateEqual=before['equal']))
(D / 'comparison.json').write_text(json.dumps(dict(passed=5, checks=checks, originalOutputSha=sha(O / 'closed-review/domain-fallback/stdout.json'),
    repairedOutputSha=sha(D / 'stdout.json'), inputSourcesUnchangedAfter=True), indent=2)+'\n')
print(json.dumps(dict(execution=execution, comparisonsPassed=5), indent=2))
