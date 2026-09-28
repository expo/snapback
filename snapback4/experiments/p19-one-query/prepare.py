"""Copy immutable calibration inputs; never open the supplied SQLite store."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
SOURCE = Path(os.environ.get('P19_EVIDENCE', '/home/ccheever/sb4-intent/rg-evidence/lane'))
WORK = HERE / '.work'
RESULTS = HERE / 'results'

def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

inputs = ['snapback/schema.q', 'scale-instance/.snapback4/store.sqlite',
          'scale-instance/.snapback4/store.sqlite-wal', 'run-log.md', 'essay.md', 'diary.md']
manifest = {name: {'bytes': (SOURCE / name).stat().st_size, 'sha256': digest(SOURCE / name)} for name in inputs}
RESULTS.mkdir(exist_ok=True)
(RESULTS / 'inputs.json').write_text(json.dumps(manifest, indent=2) + '\n')
source = (SOURCE / 'snapback/schema.q').read_text()
(HERE / 'builder.q').write_text(source)
# No earlier source checkpoint survives. Reconstruct precisely the direct
# existence expressions described in why-postState and the original probe.
overlay = '''
use personas p19owner, p19reader
query p19RawState(post: posts):
  return { liked: exists likes[post, viewer], reposted: exists reposts[viewer, post] }
query p19RawPost(id: posts):
  return posts[id] { *, authorProfile: profiles[principal = .author], liked: exists likes[.id, viewer], reposted: exists reposts[viewer, .id] }
query p19SearchOrdinary(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone last 20 by .at after c
query p19MyLikes(c: cursor ?):
  return likes where .principal = viewer first 100 by .id after c
'''
(HERE / 'probes.q').write_text(overlay)
for version in ['published', 'main']:
    dest = WORK / version / 'app'
    if dest.exists():
        raise RuntimeError(f'Refusing to overwrite an existing experiment: {dest}')
    (dest / 'snapback').mkdir(parents=True)
    (dest / 'snapback/schema.q').write_text(source + overlay)
    # Reflink if available, otherwise a real copy; never hardlink or symlink.
    subprocess.run(['cp', '-a', '--reflink=auto', str(SOURCE / 'scale-instance/.snapback4'), str(dest)], check=True)
    subprocess.run(['chmod', '-R', 'u+w', str(dest)], check=True)

variants = {
    'aggregate-explicit-sync': source.replace('view ownLikes: count likes by .principal, .post', 'view ownLikes: count likes by .principal, .post\n  read <- .principal = viewer\n  sync to .principal'),
    'aggregate-narrow-read': source.replace('view ownLikes: count likes by .principal, .post', 'view ownLikes: count likes by .principal, .post\n  read <- .principal = viewer'),
    'digest-query': source + '\nquery digestPreview(periodStart: time, periodEnd: time):\n  return digestCounts(viewer, periodStart, periodEnd)\n',
}
for name, text in variants.items():
    dest = WORK / 'diagnostics' / name / 'snapback'
    dest.mkdir(parents=True, exist_ok=True)
    (dest / 'schema.q').write_text(text)
print('Copied two independent stores and prepared three diagnostic reconstructions.')
