#!/usr/bin/env python3
"""One-way packet seal; runtime/preparation/results are outside frozen inputs."""
import argparse
from common import *

parser = argparse.ArgumentParser(); parser.add_argument('--revision', choices=['2', '3', '4', '5', '6', '7', '8', '9'])
parser.add_argument('--amend-custody-refusal', action='store_true')
args = parser.parse_args()
if (ROOT / 'PACKET.sha256').exists():
    if args.revision is None: raise SystemExit('already sealed; documented --revision required')
    n = int(args.revision)
    if not (ROOT / ('REVISION-%d.md' % n)).is_file() or not (ROOT / ('metadata/revision-%d.json' % n)).is_file():
        raise SystemExit('revision-reason-and-diff-required')
    old = ROOT / ('PACKET.v%d.sha256' % (n - 1))
    if args.amend_custody_refusal:
        from reclassification import verify_custody_recovery
        if n != 4: raise SystemExit('custody-amendment-requires-revision-4')
        recovery = verify_custody_recovery(ROOT)
        if not recovery: raise SystemExit('custody-amendment-requires-bound-refusal')
        refused = read(ROOT / recovery['path'])
        retained = ROOT / 'preparation/round3/packet-v4-before-custody-fix/PACKET.sha256'
        if sha(retained) != sha(ROOT / 'PACKET.sha256') or refused['packetSha256'] != sha(retained):
            raise SystemExit('custody-amendment-prior-packet-drift-or-already-used')
    elif not old.exists() or sha(old) != sha(ROOT / 'PACKET.sha256'):
        raise SystemExit('previous-packet-missing-or-not-current; refuse-repeat-reseal')
    revision = read(ROOT / ('metadata/revision-%d.json' % n))
    if (revision['originalPacketSha256'] != sha(ROOT / 'PACKET.v1.sha256') or
        revision.get('previousPacketSha256', revision['originalPacketSha256']) != sha(old) or
        revision['harnessDiffSha256'] != sha(ROOT / ('metadata/harness-v%d-v%d.diff' % (n - 1, n)))):
        raise SystemExit('revision-binding-mismatch')
    (ROOT / 'PACKET.sha256').unlink()

paths = []
for name in ['inputs', 'scripts', 'prompts', 'metadata']:
    root = ROOT / name
    for p in root.rglob('*'):
        if '__pycache__' in p.parts: continue
        if p.is_symlink(): raise RuntimeError('frozen-symlink:' + str(p))
        if p.is_file(): paths.append(p)
    readonly(root)
for name in ['launch-builder.sh', 'after-builder.sh', 'pilot-chain.sh', 'README.md',
             *[p.name for p in sorted(ROOT.glob('REVISION-*.md'))]]:
    p = ROOT / name; paths.append(p); p.chmod(0o555 if name.endswith('.sh') else 0o444)
put(ROOT / 'PACKET.sha256', ''.join(sha(p) + '  ' + str(p.relative_to(ROOT)) + '\n' for p in sorted(paths)))
(ROOT / 'PACKET.sha256').chmod(0o444)
print('sealed', sha(ROOT / 'PACKET.sha256'), len(paths), 'files')
