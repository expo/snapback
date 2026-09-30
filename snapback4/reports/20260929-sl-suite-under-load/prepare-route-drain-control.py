"""Prepare an event-controlled callback/teardown overlap without editing source.

Both variants keep the original incarnation refusal and custody assertions.
At teardown a separate real browser request enters a held Playwright callback.
The callback resumes when route draining starts or the page closes: the original
cleanup calls route.fetch on a closed page; the candidate drains it while live.
This is a diagnostic control outside the suite inventory, not a product test.
"""
import hashlib
import json
from pathlib import Path
import re

root = Path(__file__).resolve().parents[2]
report = Path(__file__).resolve().parent
target = root / 'target/sl-load'
source = root / 'packages/snapback4/test/admit-before-identity.test.mjs'
current = source.read_text()
old = '  t.after(() => f.close());'
new = '''  t.after(async () => {
    // @ref LLP 3000#publication-suite-under-contention — route callbacks own live browser I/O until drained.
    try { await f.page.unrouteAll({ behavior: 'wait' }); }
    finally { await f.close(); }
  });'''
# Reproduce both variants from either the pre-fix or final checked-out fixture.
assert (current.count(old), current.count(new)) in ((1, 0), (0, 1))
original = current.replace(new, old)
assert original.count(old) == 1
candidate = original.replace(old, new)
(target / 'route-drain-original.mjs').write_text(original)
(target / 'route-drain-candidate.mjs').write_text(candidate)
setup = '''  let releaseCleanup, cleanupEntered;
  const cleanupGate = new Promise(resolve => { releaseCleanup = resolve; });
  const cleanupEntry = new Promise(resolve => { cleanupEntered = resolve; });
  f.page.once('close', releaseCleanup);
  const unrouteAll = f.page.unrouteAll.bind(f.page);
  f.page.unrouteAll = async options => { releaseCleanup(); return unrouteAll(options); };
  const cleanupProbe = async () => {
    await f.page.route('**/__sl_cleanup_overlap', async route => {
      cleanupEntered(); await cleanupGate;
      const response = await route.fetch({ url: `${f.api}/schema` });
      await route.fulfill({ response });
    });
    await f.page.evaluate(() => { void fetch('/__sl_cleanup_overlap').catch(() => {}); });
    await cleanupEntry;
    t.diagnostic('cleanup entered with a held route callback');
  };
'''
files = {}
for version, full in [('before', original), ('after', candidate)]:
    prefix = full[:full.index('for (const worker of [false, true]) {')]
    body = full[full.index("  for (const failure of ['timeout', 'adoption', 'incarnation', 'restore'])"):full.index('\n}\n\nasync function nodeFixture')]
    body = body.replace("['timeout', 'adoption', 'incarnation', 'restore']", "['incarnation']", 1)
    if version == 'before':
        prefix = prefix.replace(old, setup + '  t.after(async () => { await cleanupProbe(); await f.close(); });')
    else:
        prefix = prefix.replace('  t.after(async () => {', setup + '  t.after(async () => {\n    await cleanupProbe();', 1)
    control = prefix + '\nfor (const worker of [true]) {\n  const tier = "Worker cleanup control";\n' + body + '\n}\n'
    control = re.sub(r'from ([\'"])(\.[^\'"]+)\1', lambda m: 'from ' + json.dumps(str((source.parent / m[2]).resolve())), control)
    out = target / f'controls/route-drain-{version}.test.mjs'
    out.write_text(control)
    files[version] = {'path': str(out.relative_to(root)), 'sha256': hashlib.sha256(out.read_bytes()).hexdigest()}
for version in ['original', 'candidate']:
    path = target / f'route-drain-{version}.mjs'
    files[version] = {'path': str(path.relative_to(root)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
receipt = {'source': str(source.relative_to(root)), 'files': files}
(report / 'route-drain-control-source.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))
