"""Check the packed manual against an unmodified published install, no generators.
Inputs in snapback4/target/ex-round3: plain.tgz from the published 0.2.33
Darwin installer, candidate snapback4-0.4.7.tgz, and the integrity-verified
published 0.4.7 Linux binary under linux/package/snapback4.
"""
from pathlib import Path
import argparse, hashlib, json, re, subprocess, tarfile

parser = argparse.ArgumentParser()
parser.add_argument('--named-keys', action='store_true', help='make legacy unique keys explicit for the 0.4 compiler')
args = parser.parse_args()

root = Path(__file__).resolve().parents[3]
work = root / 'target/ex-round3'
with tarfile.open(work / 'plain.tgz') as archive:
    archive.extractall(work, filter='data')
with tarfile.open(work / 'snapback4-0.4.7.tgz') as archive:
    doc = archive.extractfile('package/FOLLOWING-ADOPTION.md').read().decode()
manual, = re.findall(r'```quarry\n(.*?)```', doc, re.S)
assert 'feedApp' not in manual
assert 'plain `feed` module' in doc.split('## Installations that already contain the app bridge')[0]
project = work / 'plain'
feed = project / 'snapback/feed.q'
original = feed.read_bytes()
assert 'feedAppPublish' not in original.decode()
assert hashlib.sha256(original).hexdigest() == '865ca6b52332ea934138e3d2e2049602214bc2fa50f7dd4069fe9b2d79a8a54a'
if args.named_keys:
    migrated = original.decode()
    for old, new in [
        ('feedRemovedEvents[p.id]', 'feedRemovedEvents[id = p.id]'),
        ('feedAuthors[authorId]', 'feedAuthors[principal = authorId]'),
        ('feedAuthors[viewer]', 'feedAuthors[principal = viewer]'),
        ('feedPullCounts[viewer]', 'feedPullCounts[readerId = viewer]'),
        ('feedPullCounts[readerId]', 'feedPullCounts[readerId = readerId]'),
    ]:
        assert old in migrated
        migrated = migrated.replace(old, new)
    feed.write_text(migrated)
installed = feed.read_bytes()
# The installer also emitted the unrelated todo schema. Keep it alongside
# the existing module and the manual's documented snapback/social.q.
app = project / 'snapback/social.q'
app.write_text(manual)
binary = work / 'linux/package/snapback4'
version = subprocess.run([binary, '--version'], capture_output=True, text=True, check=True)
print(version.stdout, end='')
results = []
for label, extra, expected in [
    ('manual-module-only', '', 0),
    ('unavailable-app-bridge', '\nmutation publishExisting(postId: posts):\n  feedAppPublish(postId)\n', 1),
]:
    app.write_text(manual + extra)
    run = subprocess.run([binary, 'check'], cwd=project, capture_output=True, text=True)
    log = run.stdout + run.stderr
    print(f'== {label}: exit {run.returncode}\n{log}', flush=True)
    if expected == 0:
        assert run.returncode == 0
    else:
        assert run.returncode != 0 and 'E_QUARRY_UNKNOWN' in log and 'feedAppPublish' in log
    results.append({'case': label, 'exit_code': run.returncode, 'expected': 'pass' if expected == 0 else 'E_QUARRY_UNKNOWN'})
app.write_text(manual)
assert feed.read_bytes() == installed, 'module must remain byte-identical across controls'
print(json.dumps({'feed_sha256': hashlib.sha256(original).hexdigest(), 'explicit_keys': args.named_keys, 'tested_feed_sha256': hashlib.sha256(installed).hexdigest(), 'results': results}, indent=2))
