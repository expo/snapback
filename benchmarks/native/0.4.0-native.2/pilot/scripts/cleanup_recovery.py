"""Sealed, one-use Phase-2 continuation after the macOS cleanup EPERM."""
from common import *

LOCATION = 'attempts/snapback4-cleanup-refusal-reclassified'
OLD = 'results/snapback4/attempt-01'
DEFECT = 'cleanup-EPERM-after-passing-semantic-handoff'

def facts(root):
    old = root / OLD; summary = read(old / 'summary.json')
    if (summary.get('reason') != '[Errno 1] Operation not permitted'
        or summary.get('outcome') != 'handoff-refused-by-semantic-validator'
        or summary.get('failureStage') != 'builder-handoff-semantic'
        or summary.get('segments') != {} or summary.get('observedProductFailure') is not False
        or any((old / name).exists() for name in ('release-build.log', 'm6', 'm8'))):
        raise RuntimeError('cleanup-recovery-not-the-prebuild-EPERM')
    semantic = read(old / 'semantic-handoff/result.json')
    if (semantic.get('pass') is not True or semantic.get('beforeCompilation') is not True
        or semantic.get('beforeDeviceWork') is not True
        or semantic.get('descriptorSha256') != sha(old / 'semantic-handoff/native-fixture.json')
        or read(old / 'semantic-handoff/validator-exit.json')['exitCode'] != 0):
        raise RuntimeError('cleanup-recovery-semantic-success-required')
    for name in ('source-audit', 'prepared-source-audit'):
        review = read(old / name / 'review.json')
        fields = read(old / name / 'schema.json')['required']
        if any(review.get(k) is not True for k in fields if k not in ('citations', 'findings')):
            raise RuntimeError('cleanup-recovery-source-success-required')
    end = read(root / 'logs/snapback4/end.json')
    if (end['outcome'] != 'builder-ended' or end['exitCode'] != 0 or end['lastMilestone'] != 'm8'
        or not end['cleanup']['complete'] or not end['derivedDataCleanup']['complete']):
        raise RuntimeError('cleanup-recovery-completed-builder-required')
    for name in ('final-report.md', 'essay.md'):
        if not (root / 'lanes/snapback4' / name).is_file():
            raise RuntimeError('cleanup-recovery-builder-report-missing')
    return semantic

def capture(root):
    root = Path(root).resolve(); semantic = facts(root)
    chains = {p.name: inventory(p) for p in sorted((root / 'logs').glob('chain-*'))}
    if not chains or any(read(root / 'logs' / n / 'end.json')['exitCode'] != 2 for n in chains):
        raise RuntimeError('cleanup-recovery-chain-not-stopped')
    if (root / 'logs/convex').exists() or (root / 'results/convex').exists():
        raise RuntimeError('cleanup-recovery-convex-started')
    work = Path(read(root / OLD / 'scratch.json')['path']) / 'app'
    if (work.parent / 'DerivedData').exists(): raise RuntimeError('cleanup-recovery-build-started')
    target = root / LOCATION; target.mkdir()
    trees = {'attempt': root / OLD, 'work': work, 'lane': root / 'lanes/snapback4',
             'custody': root / 'attempts/snapback4-builder-completed'}
    manifests = {}
    for name, tree in trees.items():
        put(target / (name + '.json'), {'path': str(tree), 'inventory': inventory(tree)})
        manifests[name + '.json'] = sha(target / (name + '.json'))
    put(target / 'chains.json', chains); manifests['chains.json'] = sha(target / 'chains.json')
    put(target / 'RECLASSIFICATION.json', {
        'classification': 'harness-defect-cleanup-failure', 'defect': DEFECT,
        'authority': 'User Lane P3: fix cleanup EPERM and resume Phase-2 rerun',
        'backend': 'snapback4', 'outcomeClass': 'operator-setup', 'productOutcome': None,
        'setupRerunsConsumed': 0, 'originalAttempt': OLD, 'semanticHandoff': semantic,
        'previousPacketSha256': sha(root / 'PACKET.sha256'), 'priorChains': sorted(chains),
        'builderEndSha256': sha(root / 'logs/snapback4/end.json'), 'manifests': manifests,
        'reason': 'Both source audits and semantic validation passed; finally stop raised EPERM. No Release build or native measurement started.',
        'continuation': 'Fresh attempt from unchanged custody through both audits, semantic handoff, Release build and normal measurement; then unchanged Convex builder and measurement.',
        'at': time.time()})
    readonly(target)
    return {'path': LOCATION + '/RECLASSIFICATION.json', 'sha256': sha(target / 'RECLASSIFICATION.json')}

def verify_record(root):
    root = Path(root).resolve(); target = root / LOCATION
    binding = read(root / 'metadata/revision-8.json')['reclassification']
    if binding['path'] != LOCATION + '/RECLASSIFICATION.json' or sha(root / binding['path']) != binding['sha256']:
        raise RuntimeError('cleanup-recovery-binding')
    value = read(root / binding['path'])
    if (value['classification'], value['defect'], value['backend'], value['outcomeClass'],
        value['setupRerunsConsumed'], value['productOutcome']) != (
            'harness-defect-cleanup-failure', DEFECT, 'snapback4', 'operator-setup', 0, None):
        raise RuntimeError('cleanup-recovery-disposition')
    if (sha(root / 'PACKET.v7.sha256') != value['previousPacketSha256']
        or sha(root / 'logs/snapback4/end.json') != value['builderEndSha256']
        or facts(root) != value['semanticHandoff']):
        raise RuntimeError('cleanup-recovery-evidence-drift')
    if set(value['manifests']) != {'attempt.json', 'work.json', 'lane.json', 'custody.json', 'chains.json'}:
        raise RuntimeError('cleanup-recovery-manifests-missing')
    for name, digest in value['manifests'].items():
        if sha(target / name) != digest: raise RuntimeError('cleanup-recovery-manifest-drift')
        data = read(target / name)
        if name == 'chains.json':
            for chain, inv in data.items():
                if inventory(root / 'logs' / chain) != inv: raise RuntimeError('cleanup-recovery-chain-drift')
        elif inventory(Path(data['path'])) != data['inventory']:
            raise RuntimeError('cleanup-recovery-retained-drift:' + name)
    return {**binding, 'priorChains': value['priorChains'], 'setupRerunsConsumed': 0,
            'order': ['snapback4-after-builder', 'convex-builder', 'convex-after-builder']}

def admission(root):
    receipt = verify_record(root)
    if sorted(p.name for p in (root / 'logs').glob('chain-*')) != receipt['priorChains']:
        raise RuntimeError('cleanup-recovery-already-consumed')
    if sorted(p.name for p in (root / 'results/snapback4').glob('attempt-*')) != ['attempt-01']:
        raise RuntimeError('cleanup-recovery-measurement-already-started')
    if ((root / 'logs/convex').exists() or (root / 'results/convex').exists()
        or sorted(p.name for p in (root / 'lanes/convex').iterdir()) != ['instrument']):
        raise RuntimeError('cleanup-recovery-convex-not-cold')
    from processes import ProcessOwner, process_table
    owner = ProcessOwner.resume(root / 'logs/snapback4')
    if owner.sample(persist=False):
        raise RuntimeError('cleanup-recovery-live-builder')
    pid = read(root / OLD / 'semantic-handoff/backend-start.json')['pid']
    if any(r['pgid'] == pid and not r['state'].startswith('Z') for r in process_table().values()):
        raise RuntimeError('cleanup-recovery-live-semantic-backend')
    for backend in BACKENDS: free_ports(backend)
    return receipt

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(); parser.add_argument('--capture', action='store_true')
    args = parser.parse_args(); host_check()
    leases = [lock('chain.lock'), lock('authoring-or-operator.lock')]
    print(json.dumps(capture(ROOT) if args.capture else admission(ROOT)))
