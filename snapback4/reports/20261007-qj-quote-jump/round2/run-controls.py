"""Run deliberate generated-fixture defects against the unchanged test oracle."""
from pathlib import Path
import json
import os
import subprocess

here = Path(__file__).resolve().parent
root = here.parents[2]
expected = {
    'timeout-8s': 'failure deadline outside 3900–4500 ms',
    'highlight-100ms': 'highlight duration outside 1700–2300 ms',
    'astra-both': 'failure deadline outside 3900–4500 ms',
    'arrival-8s': 'viewport arrival exceeds 2000 ms',
    'list-only-keys': 'user input cancels all correction',
}
results = []
for mutation, assertion in expected.items():
    env = {**os.environ, 'QJ_TEST_MUTATION': mutation, 'QJ_DRIVER_DELAY_MS': '2300'}
    log = here / f'negative-{mutation}.log'
    with log.open('w') as output:
        result = subprocess.run(['node', '--test', 'packages/snapback4/test/social-quote-jump-browser.test.mjs'],
                                cwd=root, env=env, stdout=output, stderr=subprocess.STDOUT)
    text = log.read_text()
    rejected = result.returncode == 1 and assertion in text
    if mutation == 'astra-both':
        rejected &= 'highlight duration outside 1700–2300 ms' in text
    entry = {'mutation': mutation, 'driverDelayMs': 2300, 'exit': result.returncode,
             'expectedAssertion': assertion, 'rejectedForExpectedReason': rejected}
    results.append(entry)
    print(json.dumps(entry), flush=True)
(here / 'negative-results.json').write_text(json.dumps(results, indent=2) + '\n')
assert all(result['rejectedForExpectedReason'] for result in results), results
