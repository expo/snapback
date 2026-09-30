"""Delay the first result after publication, before its retry can be installed.

Use final per-row-retry source by default, or pass a prepared candidate path.
Both controls preserve all semantic assertions and use the corrected cleanup;
only the original sixty-turn premise versus event barrier differs. They live
outside the suite inventory and are focused diagnostic controls.
"""
import hashlib
import json
from pathlib import Path
import sys

report = Path(__file__).resolve().parent
root = report.parents[1]
source = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root / 'packages/snapback4/test/per-row-retry.test.mjs'
original = source.read_text()
barrier = """    await pump(t, () => retries.some(event => event.watch === owner), 'due-result retry installed');
    assert.deepEqual(retries.map(event => event.delay), [25], 'one retry uses the original 25 ms backoff');"""
assert original.count(barrier) == 1
text = original.replace("'../dist/", repr(str(root / 'packages/snapback4/dist'))[:-1] + '/')
text = text.replace("'../src/wasm/", repr(str(root / 'packages/snapback4/src/wasm'))[:-1] + '/')
text = text.replace("'./helpers/app-server.mjs'", repr(str(root / 'packages/snapback4/test/helpers/app-server.mjs')))
text = text.replace("const pause = () =>", "const realTimeout = globalThis.setTimeout;\nlet diagnosticClock = 0;\nconst pause = () =>", 1)
needle = '        this.deadlines = { device: null, server: deadline + 60_000, localWakeup: false };'
assert text.count(needle) == 1
text = text.replace(needle, needle + "\n        await new Promise(resolve => realTimeout(resolve, 750));", 1)
text = text.replace('    events.push({ watch, delay });',
    '    events.push({ watch, delay });\n    t.diagnostic(`retry installed at mock ${diagnosticClock} ms, delay ${delay} ms`);', 1)
text = text.replace('    t.mock.timers.tick(25);',
    '    diagnosticClock += 25; t.diagnostic(`clock advances to ${diagnosticClock} ms`);\n    t.mock.timers.tick(25);', 1)
# Keep the original diagnostic guard, so the deliberately frozen before case
# reports its original assertion promptly. Full-suite source keeps its guard.
text = text.replace('performance.now() + 60_000', 'performance.now() + 5000', 1)
output = root / 'target/sl-load/controls'
output.mkdir(parents=True, exist_ok=True)
records = []
for mode in ['before', 'after']:
    body = text if mode == 'after' else text.replace(barrier, '    for (let i = 0; i < 60; i++) await pause();', 1)
    path = output / f'retry-installation-{mode}.test.mjs'
    path.write_text(body)
    records.append({'mode': mode, 'source': str(source.relative_to(root)),
                    'source_sha256': hashlib.sha256(original.encode()).hexdigest(),
                    'control': str(path.relative_to(root)), 'control_sha256': hashlib.sha256(body.encode()).hexdigest(),
                    'delay_ms': 750, 'diagnostic_guard_ms': 5000, 'cleanup': 'close then release frozen background sleep; restore real timers'})
(report / 'retry-control-sources.json').write_text(json.dumps(records, indent=2) + '\n')
print('Prepared retry installation controls; no tests executed.')
