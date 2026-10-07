#!/usr/bin/env python3
"""Check the replay's evidence, preserving failures instead of counting retries."""
import hashlib, json, pathlib, re, sys
sb4 = pathlib.Path(__file__).resolve().parents[4]
base = sb4 / 'reports/20261007-fl-dry-run-flakes/round-8'
out = base / 'evidence/final-load'
summary = json.loads((out / 'summary.json').read_text())
assert summary['inputsUnchanged'] and summary['loopsReaped']
assert len(summary['rounds']) == 40

def prior_background(current):
    # The only post-replay change adds failure diagnostics. Reverse its exact
    # patch in memory, without touching any source or executable on disk.
    patch = (base / 'reproduce/maintenance-diagnostics.patch').read_text().splitlines(True)
    current = current.splitlines(True)
    result, cursor, i = [], 0, 0
    while i < len(patch):
        match = re.match(r'@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@', patch[i])
        if not match: i += 1; continue
        start = int(match[1])-1
        result += current[cursor:start]; cursor = start; i += 1
        while i < len(patch) and not patch[i].startswith('@@'):
            prefix, text = patch[i][0], patch[i][1:]
            if prefix in ' +':
                assert current[cursor] == text, patch[i]
                cursor += 1
            if prefix in ' -': result.append(text)
            i += 1
    return ''.join(result + current[cursor:])

for file, sha in summary['inputs']['sourceHashes'].items():
    source = (sb4 / file).read_text()
    if hashlib.sha256(source.encode()).hexdigest() != sha:
        assert file == 'packages/snapback4/test/export-background.test.mjs', file
        assert hashlib.sha256(prior_background(source).encode()).hexdigest() == sha
        # Bind the separately executed diagnostic candidate, without claiming
        # its full run passed: that run retained a native /proc inspection red.
        assert hashlib.sha256(source.encode()).hexdigest() == 'e617259a83df30014c25d11a040c4c274c91676d2a843ff64927ccb1b9783941'
        line = next(line for line in (base / 'evidence/background-diagnostics-final.log').read_text().splitlines()
                    if line.startswith('AssertionError [ERR_ASSERTION]: {'))
        final = json.loads(line.partition(': ')[2])
        assert not final['passed'] and final['counts']['pass'] == 62 and final['counts']['fail'] == 1
        assert final['counts']['skipped'] == 32 and final['keeperExit']['cleanupAcknowledged']

expected = {'background': [63], 'other': [3,15,8,2,1,6,3]}
rows, failures = [], []
for n in range(1,21):
    for kind, counts in expected.items():
        text = (out / f'{kind}-{n:02}.log').read_text()
        batch = [json.loads(line[len('LOAD_RESULT '):]) for line in text.splitlines() if line.startswith('LOAD_RESULT ')]
        if not batch and kind == 'background':
            line = next(line for line in text.splitlines() if line.startswith('AssertionError [ERR_ASSERTION]: {'))
            batch = [json.loads(line.partition(': ')[2])]
        assert len(batch) == len(counts)
        for row, count in zip(batch, counts):
            assert row['signal'] is None and row['code'] in [0,1], row
            assert row['passed'] == (row['code'] == 0), row
            assert row['counts']['pass'] + row['counts']['fail'] == count, row
            assert row['counts']['skipped'] == (32 if kind == 'background' else 0), row
            assert row['counts']['cancelled'] == 0, row
            assert row['keeperExit']['cleanupAcknowledged'], row
            assert 'reason' not in row and 'inspectionFailure' not in row, row
        if any(not row['passed'] for row in batch):
            failures.append(dict(round=n, group=kind, cases=re.findall(r'^not ok \d+ - (.*)$',text,re.M)))
        rows += batch
result = dict(loadedResults=len(rows), passes=sum(r['counts']['pass'] for r in rows),
              skips=sum(r['counts']['skipped'] for r in rows), failures=sum(r['counts']['fail'] for r in rows),
              failedCases=failures, allKeeperReleasesAcknowledged=True,
              ownedLoopsReaped=True, replayInputsFixed=True)
(out / 'verified.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(result))
sys.exit(1 if result['failures'] else 0)
