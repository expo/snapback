#!/usr/bin/env python3
"""Archive only after every primary timing cell has finished successfully."""
import gzip, json, shutil
from pathlib import Path

r = Path(__file__).resolve().parents[1]
sb4 = r.parents[2]
names = [f'mixed-{v}-{level}' for v in ['demoted', 'ordinary', 'split']
         for level in ['0', '0.5', '1', '1.5']]
names += ['mixed-following-split']
names += [f'drain-{v}-{busy}-{trial}' for v in ['demoted', 'ordinary', 'split']
          for busy in [0, 96] for trial in [1, 2]]
for name in names:
    assert (r / (name + '.exit')).read_text().strip() == '0', name
    assert (r / name / 'summary.json').is_file(), name
assert len(json.loads((r / 'mixed-following-split/summary.json').read_text())) == 4

retained = sb4 / 'target/ct-round3/retained-projects'
retained.mkdir(parents=True, exist_ok=True)
for project in sorted(r.glob('mixed-*/level-*/project')):
    destination = retained / (project.parent.parent.name + '-' + project.parent.name)
    assert not destination.exists(), destination
    project.rename(destination)
    print('retained', destination.name, flush=True)

for path in sorted(r.rglob('*')):
    if path.is_file() and (path.name in ['samples.json', 'backlog.json', 'server.log', 'prepare-server.log']
                          or (path.suffix == '.log' and path.read_bytes().endswith(b'\n\n'))):
        destination = path.with_name(path.name + '.gz')
        assert not destination.exists(), destination
        with path.open('rb') as src, destination.open('wb') as dst:
            with gzip.GzipFile(filename='', mode='wb', fileobj=dst, mtime=0) as zipped:
                shutil.copyfileobj(src, zipped)
        path.unlink()
        print('compressed', path.relative_to(r), flush=True)
