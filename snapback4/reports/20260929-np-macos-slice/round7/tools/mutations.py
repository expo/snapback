from pathlib import Path
import json, os, shutil, subprocess

root = Path('/Users/ccheever/sb4-np')
repo = root / 'lane/snapback4'
out = root / 'evidence/round7'
helper = Path('crates/snapback4/src/verbs/witness')
test = Path('packages/snapback4/test')
old_closure = subprocess.check_output(['git', 'show', '209c6ebebbeaa2d99903680afcd38e62c1d61965:snapback4/' + str(helper / 'native-closure.mjs')], cwd=repo, text=True)
start, end = 'export function canonical(file) {', '// Deliberately no shell evaluation.'
old_canonical = old_closure[old_closure.index(start):old_closure.index(end)]
rows = []
for name in ['baseline', 'lexical-canonical', 'missing-snapshot-guard']:
    copy = out / 'mutations' / name
    (copy / helper).mkdir(parents=True)
    (copy / test).mkdir(parents=True)
    for file in (repo / helper).glob('*.mjs'):
        shutil.copy2(file, copy / helper / file.name)
    for file in ['witness-preparation.test.mjs', 'witness-preparation-fixture.mjs']:
        shutil.copy2(repo / test / file, copy / test / file)
    if name == 'lexical-canonical':
        file = copy / helper / 'native-closure.mjs'
        source = file.read_text()
        file.write_text(source[:source.index(start)] + old_canonical + source[source.index(end):])
    if name == 'missing-snapshot-guard':
        file = copy / helper / 'prepare.mjs'
        source = file.read_text()
        guard = "  if (inventory(snapshot, sourceOmit).sha256 !== sourceSnapshot.sha256) fail('E_WITNESS_PROOF', 'snapshot source changed during preparation');\n"
        assert source.count(guard) == 1
        file.write_text(source.replace(guard, ''))
    argv = [str(Path.home() / 'np-tools/node/bin/node'), '--test', str(copy / test / 'witness-preparation.test.mjs')]
    with (out / ('mutation-' + name + '.log')).open('x') as log:
        result = subprocess.run(argv, env=dict(os.environ, TMPDIR=str(root / 'tmp')), stdout=log, stderr=subprocess.STDOUT)
    rows.append(dict(name=name, argv=argv, exitStatus=result.returncode))
    (out / 'mutations.json').write_text(json.dumps(rows, indent=2) + '\n')
    assert result.returncode == (0 if name == 'baseline' else 1), rows[-1]
print('Passing baseline; lexical resolution and snapshot-custody mutations detected.')
