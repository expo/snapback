from pathlib import Path
import shutil, subprocess, json, os
r = Path('/Users/ccheever/sb4-np')
repo = r / 'lane/snapback4'
e = r / 'evidence/round6'
helper = Path('crates/snapback4/src/verbs/witness')
tests = Path('packages/snapback4/test')
cases = [
    ('baseline', None, None, None),
    ('overwrite-link', 'prepare.mjs',
     "  fs.rmSync(localEnv, { force: true });\n  fs.writeFileSync(localEnv, `export NODE_BINARY=${shellQuote(process.execPath)}\\n`, { flag: 'wx' });",
     "  fs.writeFileSync(localEnv, `export NODE_BINARY=${shellQuote(process.execPath)}\\n`);"),
    ('writable-receipt', 'payload.mjs', ", mode: 0o444", ''),
]
cases.extend([('sibling-output', 'native-closure.mjs', "'PER_ARCH_MODULE_FILE_DIR', ", ''), ('relative-output', 'native-closure.mjs', "['INFOPLIST_PATH', 'DWARF_DSYM_FILE_NAME'].includes(key)", 'false'), ('dangling-output', 'native-closure.mjs', '  while (!fs.lstatSync(parent, { throwIfNoEntry: false }) && parent !== path.dirname(parent)) parent = path.dirname(parent);\n  // existsSync follows links and treats a dangling link as an absent leaf.\n  // Such an output can create its missing target outside the private cache.\n  if (fs.lstatSync(parent).isSymbolicLink() && !fs.existsSync(parent)) refuse(`unresolved native symlink: ${parent}`);\n', '  while (!fs.existsSync(parent) && parent !== path.dirname(parent)) parent = path.dirname(parent);\n'), ('session-pin', 'native-closure.mjs', '    CLANG_MODULES_BUILD_SESSION_FILE: `${d}/ModuleCache.noindex/Session.modulevalidation`,\n', '')])
rows = []
os.umask(0o022)
for name, file, old, new in cases:
    d = e / 'mutations-final' / name
    (d / helper).mkdir(parents=True)
    (d / tests).mkdir(parents=True)
    for f in (repo / helper).glob('*.mjs'):
        shutil.copy2(f, d / helper / f.name)
    for f in ['witness-preparation.test.mjs', 'witness-preparation-fixture.mjs']:
        shutil.copy2(repo / tests / f, d / tests / f)
    if file:
        p = d / helper / file
        s = p.read_text()
        assert s.count(old) == 1
        p.write_text(s.replace(old, new))
    argv = [str(Path.home() / 'np-tools/node/bin/node'), '--test', '--test-name-pattern',
            'preparation rejects', str(d / tests / 'witness-preparation.test.mjs')]
    with (e / f'mutation-final-{name}.log').open('x') as log:
        code = subprocess.run(argv, stdout=log, stderr=subprocess.STDOUT,
                              env=dict(os.environ, TMPDIR=str(r / 'tmp'))).returncode
    rows.append(dict(name=name, argv=argv, exitStatus=code, file=file, old=old, new=new))
    (e / 'mutations-final.json').write_text(json.dumps(rows, indent=2) + '\n')
    assert code == (0 if file is None else 1), (name, code)
print('Passing final baseline; all six mutations detected')
