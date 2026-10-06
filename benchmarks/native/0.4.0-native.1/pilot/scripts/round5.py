"""Bound Round 5 admission: retained Convex authoring, no builder replay/retry.

SB4's diagnostic stopped at a builder fixture defect before launch. Its original
never-admissible artifacts remain intact; there is no harness repair to rerun.
"""
import re
from common import *
from reclassification import stat_inventory, live_cleanup

LOCATION = 'attempts/convex-replay-boundary-reclassified'
DEFECT = 'single-replay-interval-rejects-required-post-M8-rerun'
MISSING = 'not-executed (harness defect)'
ASYMMETRY = ('resolved: both lanes reached M8 green; neither post-M8 replay ran, '
             'and both essay/final reports are absent because of replay harness defects. '
             'Convex alone retains a completed M6 replay; no equivalence of replay evidence is claimed.')

def facts(root):
    logs = root / 'logs/convex'; lane = root / 'lanes/convex'
    end = read(logs / 'end.json')
    if (end['outcome'], end['reason'], end['lastMilestone'], end['exitCode']) != (
            'setup-failure', 'invalid-replay-boundary', 'm8', -15):
        raise RuntimeError('convex-reclassification-wrong-termination')
    if end['termination']['reason'] != 'invalid-replay-boundary':
        raise RuntimeError('convex-reclassification-wrong-termination')
    if not end['cleanup']['complete'] or not end['derivedDataCleanup']['complete']:
        raise RuntimeError('convex-reclassification-cleanup-incomplete')
    requests = [json.loads(x) for x in (logs / 'boundary-requests.jsonl').read_text().splitlines()]
    expected = read(Path(__file__).parent / 'fixtures/convex-round4-boundaries.json')
    if requests != expected: raise RuntimeError('convex-reclassification-wrong-boundaries')
    terminals = re.findall(r'^(\d+) (m\d+) terminal green\b', (lane / 'run-log.md').read_text(), re.M)
    if [m for _, m in terminals] != list(MILESTONES):
        raise RuntimeError('convex-reclassification-authoring-incomplete')
    at = int(terminals[-1][0]); replay_at = requests[-1]['at']
    if not at < replay_at <= end['termination']['observedAt'] <= end['at']:
        raise RuntimeError('convex-reclassification-time-order')
    if any((lane / name).exists() for name in ('essay.md', 'final-report.md')):
        raise RuntimeError('convex-reclassification-report-presence-mismatch')
    events = [json.loads(x) for x in (logs / 'watchdog.jsonl').read_text().splitlines()]
    boundaries = [e for e in events if e['kind'] == 'boundary']
    if [(e['phase'], e['requestedAt']) for e in boundaries] != [(e['phase'], e['at']) for e in requests[:-1]]:
        raise RuntimeError('convex-reclassification-admitted-boundaries')
    intervals = [e['wallSeconds'] for e in events if e['kind'] == 'replay-end']
    if len(intervals) != 1 or not 0 < intervals[0] < 14400:
        raise RuntimeError('convex-reclassification-replay-clock')
    if any(n >= 2000000 for n in read(logs / 'phase-token-sampling.json')['tokens'].values()):
        raise RuntimeError('convex-reclassification-token-cap')
    receipt = lane / 'evidence/scale-replay-receipt.json'
    if read(receipt)['pass'] is not True: raise RuntimeError('convex-reclassification-M6-replay')
    return {'authoringTerminal': {'milestone': 'm8', 'terminal': 'green', 'at': at},
        'harnessTermination': {'boundary': 'replay-start', 'requestedAt': replay_at,
            'observedAt': end['termination']['observedAt'], 'completedAt': end['at'], 'exitCode': -15},
        'M6Replay': {'status': 'completed; original evidence retained', 'supervisorWallSeconds': intervals[0],
                    'receiptSha256': sha(receipt)}}

def capture(root):
    target = root / LOCATION
    value = facts(root); cleanup = live_cleanup(root, 'convex')
    target.mkdir()
    manifests = {}
    for key, name in {'lane': 'lanes/convex', 'logs': 'logs/convex',
                      'quarantine': 'runtime/builder-convex/derived-data'}.items():
        path = root / name; stats = stat_inventory(path)
        if key != 'logs' and any(max(s['mtimeNs'], s['ctimeNs']) / 1e9 >
                value['harnessTermination']['completedAt'] for s in stats.values()):
            raise RuntimeError('convex-reclassification-post-termination-mutation:' + key)
        inv = inventory(path)
        if stat_inventory(path) != stats: raise RuntimeError('convex-reclassification-capture-race')
        put(target / (key + '.json'), {'tree': name, 'inventory': inv, 'stats': stats})
        manifests[key + '.json'] = sha(target / (key + '.json'))
    chains = {p.name: inventory(p) for p in sorted((root / 'logs').glob('chain-*'))}
    if any(not (root / 'logs' / name / 'end.json').exists() for name in chains):
        raise RuntimeError('convex-reclassification-prior-chain-running')
    put(target / 'chains.json', chains); manifests['chains.json'] = sha(target / 'chains.json')
    value.update(classification='completed-authoring-harness-defect', defect=DEFECT, backend='convex',
        setupRerunsConsumed=0, postM8Replay=MISSING,
        missingReports={name: 'absent (harness defect)' for name in ('essay.md', 'final-report.md')},
        productEvidence='retained; admitted to normal gating native measurement',
        asymmetry=ASYMMETRY, packetV5Sha256=sha(root / 'PACKET.v5.sha256'),
        priorChains=sorted(chains), retainedManifests=manifests, cleanupVerification=cleanup,
        custodyBasis='No termination-time content manifest. Lane/quarantine mtime/ctime precede end; complete content and inode/time witnesses captured now and reverified before custody.',
        authority='User Lane P2A Round 5', at=time.time())
    put(target / 'RECLASSIFICATION.json', value); readonly(target)
    return {'path': LOCATION + '/RECLASSIFICATION.json', 'sha256': sha(target / 'RECLASSIFICATION.json')}

def verify_record(root, live=True):
    binding = read(root / 'metadata/revision-6.json')['reclassification']
    target = root / LOCATION; expected = target / 'RECLASSIFICATION.json'
    if binding['path'] != LOCATION + '/RECLASSIFICATION.json' or sha(expected) != binding['sha256']:
        raise RuntimeError('convex-reclassification-seal-binding')
    value = read(expected)
    if (value['classification'], value['defect'], value['backend'], value['setupRerunsConsumed'],
        value['postM8Replay'], value['asymmetry']) != (
        'completed-authoring-harness-defect', DEFECT, 'convex', 0, MISSING, ASYMMETRY):
        raise RuntimeError('convex-reclassification-disposition')
    if sha(root / 'PACKET.v5.sha256') != value['packetV5Sha256']:
        raise RuntimeError('convex-reclassification-prior-seal-drift')
    for key, fact in facts(root).items():
        if value[key] != fact: raise RuntimeError('convex-reclassification-fact-drift:' + key)
    if set(value['retainedManifests']) != {'lane.json', 'logs.json', 'quarantine.json', 'chains.json'}:
        raise RuntimeError('convex-reclassification-manifest-missing')
    for name, digest in value['retainedManifests'].items():
        if sha(target / name) != digest: raise RuntimeError('convex-reclassification-manifest-drift')
    for name in ('lane', 'logs', 'quarantine'):
        m = read(target / (name + '.json')); tree = root / m['tree']
        if stat_inventory(tree) != m['stats'] or inventory(tree) != m['inventory']:
            raise RuntimeError('convex-reclassification-custody-drift:' + name)
    chains = read(target / 'chains.json')
    if sorted(chains) != value['priorChains']: raise RuntimeError('convex-reclassification-chain-list')
    for name, inv in chains.items():
        if inventory(root / 'logs' / name) != inv or not (root / 'logs' / name / 'end.json').exists():
            raise RuntimeError('convex-reclassification-prior-chain-drift')
    if live: live_cleanup(root, 'convex')
    return {**binding, 'classification': value['classification'], 'postM8Replay': MISSING,
        'M6Replay': value['M6Replay'], 'missingReports': value['missingReports'],
        'setupRerunsConsumed': 0, 'asymmetry': ASYMMETRY}

def admission(root):
    receipt = verify_record(root)
    prior = sorted(p.name for p in (root / 'logs').glob('chain-*'))
    if prior != read(root / receipt['path'])['priorChains']:
        raise RuntimeError('round5-already-consumed')
    if (root / 'results/convex').exists() or (root / 'attempts/convex-builder-completed').exists():
        raise RuntimeError('round5-measurement-already-started')
    revision = read(root / 'metadata/revision-6.json'); binding = revision['diagnosis']
    path = root / 'metadata/round5-diagnosis.json'
    if binding['path'] != str(path.relative_to(root)) or sha(path) != binding['sha256']:
        raise RuntimeError('round5-diagnosis-binding')
    diagnosis = read(path)
    if diagnosis['cause'] != 'builder-fixture-compose-nonce-before-launch' or diagnosis['diagnosticRerun'] is not False:
        raise RuntimeError('round5-diagnostic-rerun-not-authorized-by-finding')
    for name, digest in diagnosis['evidence'].items():
        if sha(root / name) != digest: raise RuntimeError('round5-diagnosis-evidence-drift:' + name)
    return {**receipt, 'priorChains': prior, 'diagnosis': binding,
        'order': ['convex-after-builder'], 'snapback4DiagnosticRerun': False,
        'reason': 'builder fixture defect, no fixable harness launch cause; qualified instrument unchanged', 'at': time.time()}

if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser(); p.add_argument('--capture', action='store_true'); p.add_argument('--admission', action='store_true')
    args = p.parse_args(); host_check()
    leases = [lock('chain.lock'), lock('authoring-or-operator.lock')]
    print(json.dumps(capture(ROOT) if args.capture else admission(ROOT) if args.admission else verify_record(ROOT)))
