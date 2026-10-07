"""Run deliberate generated-fixture defects against the unchanged test oracle."""
from pathlib import Path
import json
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed

here = Path(__file__).resolve().parent
root = here.parents[2]
expected = {
    'timeout-8s': 'failure deadline outside 3900–4500 ms',
    'highlight-100ms': 'highlight duration outside 1700–2300 ms',
    'astra-both': 'failure deadline outside 3900–4500 ms',
    'arrival-8s': 'viewport arrival exceeds 2000 ms',
    'list-only-keys': 'user input cancels all correction',
    'short-far-highlight': 'highlight duration outside 1700–2300 ms',
    'late-highlight': 'highlight duration outside 1700–2300 ms',
    'editable-keys-cancel': 'editing must not cancel',
}
results = []
def run(mutation, assertion):
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
    return entry
with ThreadPoolExecutor(max_workers=2) as pool:
    pending = [pool.submit(run, mutation, assertion) for mutation, assertion in expected.items()]
    for done in as_completed(pending):
        entry = done.result(); results.append(entry); print(json.dumps(entry), flush=True)
results.sort(key=lambda result: list(expected).index(result["mutation"]))
(here / 'negative-results.json').write_text(json.dumps(results, indent=2) + '\n')
assert all(result['rejectedForExpectedReason'] for result in results), results
