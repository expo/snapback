"""Summarize completed qualification; never turn incomplete runs into passes."""
import hashlib
import json
import pathlib
import re
import statistics

ROOT = pathlib.Path.cwd()
REPORT = pathlib.Path(__file__).resolve().parent
suite = json.loads((REPORT / 'full-suite-status.json').read_text())
assert suite['status'] in [0, 1], suite
log = (ROOT / 'target/wd/full-suite.log').read_text()
suite['summary'] = re.findall(r'== \d+ failure\(s\) in \d+ s', log)[-1]
assert (suite['status'] == 0) == suite['summary'].startswith('== 0 failure(s)')
suite['stages'] = re.findall(r'-- ok: (.+)', log)
suite['failedStages'] = re.findall(r'-- FAIL: (.+)', log)
suite['intervention'] = json.loads((REPORT / 'retained-suite-stall.json').read_text())
suite['rust'] = dict(zip(['passed', 'failed', 'ignored'],
                        map(sum, zip(*(map(int, values) for values in re.findall(
                            r'test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored', log))))))
for label in ['client tests', 'client models']:
    section = re.split('-- (?:ok|FAIL): ' + label, log.split('== ' + label + '\n', 1)[1], maxsplit=1)[0]
    suite[label] = {key: int(re.findall('ℹ ' + key + r' (\d+)', section)[-1])
                    for key in ['tests', 'pass', 'fail', 'skipped', 'cancelled']}
(REPORT / 'full-suite-summary.json').write_text(json.dumps(suite, indent=2) + '\n')

def distribution(values):
    return dict(n=len(values), min=min(values), median=statistics.median(values), max=max(values))

summary = {}
hashes = []
for phase in ['before', 'after']:
    rows = json.loads((REPORT / f'exports-{phase}.json').read_text())
    assert len(rows) == 8
    for row in rows:
        assert row['status'] == 0 and row['nativeCache']['hit'], row
        assert row['loadedHash'] == row['exportHash'], row
        assert len(row['segments']) == 3 and set(row['segments'].values()) == {'passed'}, row
        hashes.append(row['loadedHash'])
    summary[phase] = {}
    for starter in ['plain', 'social']:
        warm = [r for r in rows if r['starter'] == starter and r['warm']]
        assert len(warm) == 3
        summary[phase][starter] = dict(totalSeconds=distribution([r['seconds'] for r in warm]),
                                      nativeSeconds=distribution([r['nativeDurationMs'] / 1000 for r in warm]))
assert len(set(hashes)) == 16, 'Each runtime marker must produce a distinct exported/loaded bundle'
summary['qualification'] = dict(exports=16, nativeCacheHits=16, matchingDistinctBundles=16,
                                passingLifecycleSegments=48, excludedWarmupSamples=4,
                                inputs='NX round-9 audited 0.4.11 starters; baseline and patched 0.4.12 CLIs')
summary['binaries'] = {name: hashlib.sha256((ROOT / 'target/wd' / name).read_bytes()).hexdigest()
                       for name in ['baseline-production', 'candidate-production']}
(REPORT / 'timing-summary.json').write_text(json.dumps(summary, indent=2) + '\n')

loaded = json.loads((REPORT / 'loaded-qualification.json').read_text())
assert all(hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == sha
           for path, sha in loaded['source'].items())
print(json.dumps(dict(suite=suite, timings=summary), indent=2))
