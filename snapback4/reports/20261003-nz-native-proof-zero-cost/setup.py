"""Restore the audited NX fixtures into this lane only; no other worktrees."""
import hashlib, json, os, pathlib, shutil, subprocess, tarfile
ROOT = pathlib.Path(__file__).resolve().parents[2]
WORK = ROOT / 'target/nz'
REPORT = pathlib.Path(__file__).resolve().parent
ARCHIVE = pathlib.Path.home() / 'sb4-np/evidence-archive/20261001-nx-export-proves-native/blobs'
rows = []
for name, sha in [('snapback4', 'b8fe95888b0535164990b43d9516b84d96df8b3933a1a077cbafd6082a67ffad'), ('snapback4-expo', 'c01c01d6aa4ce537aafce02fa1cdb1e7f92de55765a53084079cf8e626b84191')]:
    src = ARCHIVE / sha
    assert hashlib.sha256(src.read_bytes()).hexdigest() == sha
    (WORK / 'packages').mkdir(exist_ok=True)
    shutil.copyfile(src, WORK / 'packages' / f'{name}-0.4.11.tgz')
    rows.append(dict(name=name, sha256=sha))
for starter, sha in [('plain', '92b6e2289035ce722a1d967d67366dc311d42c39592340a18be3fc3fefeea670'), ('social', 'f6dc740652f2dec946a872c43875aeab8aca6796d76856b257e495b43c123f07')]:
    src = ARCHIVE / sha
    assert hashlib.sha256(src.read_bytes()).hexdigest() == sha
    project = WORK / starter
    project.mkdir(exist_ok=True)
    with tarfile.open(src) as tar:
        for member in tar.getmembers():
            p = pathlib.PurePosixPath(member.name)
            assert not p.is_absolute() and '..' not in p.parts
            assert not member.issym() and not member.islnk()
        tar.extractall(project)
    with (WORK / f'{starter}-install.log').open('w') as log:
        subprocess.run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=project, stdout=log, stderr=log, check=True)
    for seed in json.loads((ROOT / 'reports/20261001-nx-export-proves-native/round3/download-seeds.json').read_text()):
        if seed['starter'] != starter: continue
        src = pathlib.Path(seed['source'])
        assert hashlib.sha256(src.read_bytes()).hexdigest() == seed['sha256']
        dst = project / '.snapback4-witness/home/Library/Caches/ReactNative' / src.name
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
    subprocess.run([str(WORK / 'baseline-production'), 'check'], cwd=project, check=True)
    rows.append(dict(name=starter, sha256=sha, project=str(project)))
(REPORT / 'setup.json').write_text(json.dumps(rows, indent=2) + '\n')
