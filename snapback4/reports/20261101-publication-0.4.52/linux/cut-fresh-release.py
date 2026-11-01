#!/usr/bin/env python3
"""Apply the reviewed release-version field set to a fresh origin/main branch."""
from pathlib import Path
import json, re, subprocess, tomllib

root = Path('/home/ccheever/sb4-pub-0441')
work = root / 'snapback4'
records = Path('/home/ccheever/sb4-pub-0452-records')
run = lambda *args: subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()
assert not run('status', '--porcelain'), 'fresh release needs a clean checkout'
base = run('rev-parse', 'HEAD')
assert base == run('rev-parse', 'origin/main'), 'cut only on freshly fetched origin/main'
landed = Path('/home/ccheever/sb4-pub-0452-kit/opening-main-pushed.sha').read_text().strip()
subprocess.run(['git', '-C', str(root), 'merge-base', '--is-ancestor', landed, base], check=True)
assert 'openingRefused' in (work / 'packages/snapback4/src/react.tsx').read_text()
assert 'const waitForBrowser' in (work / 'packages/snapback4/test/social-browser.test.mjs').read_text()

manifest = work / 'Cargo.toml'
assert tomllib.loads(manifest.read_text())['workspace']['package']['version'] == '0.4.50'
text = manifest.read_text()
assert text.count('version = "0.4.50"') == 1
manifest.write_text(text.replace('version = "0.4.50"', 'version = "0.4.52"'))

crates = {'snapback4', 'snapback4-core', 'snapback4-device', 'snapback4-difftest', 'snapback4-lang', 'snapback4-native', 'snapback4-sim'}
lock = work / 'Cargo.lock'
blocks = lock.read_text().split('[[package]]')
updated = set()
for i, block in enumerate(blocks):
    found = re.search(r'^name = "([^"]+)"$', block, re.M)
    if found and found[1] in crates:
        assert 'version = "0.4.50"' in block
        blocks[i] = block.replace('version = "0.4.50"', 'version = "0.4.52"', 1)
        updated.add(found[1])
assert updated == crates
lock.write_text('[[package]]'.join(blocks))

packages = ['snapback4', 'snapback4-darwin-arm64', 'snapback4-linux-x64', 'snapback4-expo']
for name in packages:
    path = work / 'packages' / name / 'package.json'
    value = json.loads(path.read_text())
    assert value['version'] == '0.4.50'
    value['version'] = '0.4.52'
    if name == 'snapback4':
        assert set(value['optionalDependencies']) == {'snapback4-darwin-arm64', 'snapback4-linux-x64'}
        assert all(v == '0.4.50' for v in value['optionalDependencies'].values())
        value['optionalDependencies'] = {key: '0.4.52' for key in value['optionalDependencies']}
    path.write_text(json.dumps(value, indent=2) + '\n')

for name in ['device-version', 'sync-generation']:
    path = work / 'packages/snapback4/test' / (name + '.test.mjs')
    text = path.read_text()
    old = "assert.equal(packageVersion, '0.4.50', 'release fixture pin follows the package bump');"
    assert text.count(old) == 1
    path.write_text(text.replace(old, old.replace('0.4.50', '0.4.52')))

path = work / 'packages/snapback4/reference/CHANGELOG.md'
text = path.read_text()
assert '## 0.4.52\n' in text and '## 0.4.50\n' in text
prefix, remainder = text.split('## 0.4.50\n', 1)
pattern = r'- \*\*Behavior change \(2026-10-30\):\*\*.*?(?=\n\n)'
match = re.search(pattern, prefix, re.S)
if match:
    paragraph = ' '.join(line.strip() for line in match[0].splitlines())
    paragraph = paragraph.replace('**Behavior change (2026-10-30):**', '**Behavior change:**')
    paragraph = re.sub(r' Author ruling:.*Lane C qualification follows the flip\.', '', paragraph)
    prefix = prefix[:match.start()] + paragraph + prefix[match.end():]
note = '- Includes the changes listed under 0.4.50 below; that version was not published.\n'
if note not in prefix:
    prefix = prefix.replace('### Guide changes\n\n', '### Guide changes\n\n' + note, 1)
mark = '\n- Not published; its changes ship in 0.4.52.\n'
assert 'Not published; its changes ship in 0.4.52.' not in remainder
path.write_text(prefix + '## 0.4.50\n' + mark + remainder)

prior_bump = run('rev-parse', 'ca4be0ad')
summary = {'base': base, 'previousReleaseBump': prior_bump, 'crateVersions': sorted(updated), 'packageVersions': packages,
           'changedPaths': run('diff', '--name-only').splitlines(), 'route': 'fresh cut on then-current origin/main, not the stale release draft'}
(records / 'fresh-release-cut.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary, indent=2))
