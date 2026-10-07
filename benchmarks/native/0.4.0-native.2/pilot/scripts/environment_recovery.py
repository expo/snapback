"""One-use continuation from custody after the machine-local Xcode env refusal."""
from common import *

LOCATION = 'attempts/convex-environment-leak-reclassified'
OLD = 'results/convex/attempt-01'

def facts(root):
    old = root / OLD; summary = read(old / 'summary.json')
    if (summary.get('outcome') != 'handoff-refused-by-source-audit'
        or summary.get('segments') != {} or summary.get('observedProductFailure') is not False
        or summary.get('cleanupComplete') is not True
        or any((old / name).exists() for name in ('release-build.log', 'semantic-handoff', 'm6', 'm8'))):
        raise RuntimeError('environment-recovery-not-prebuild-audit-refusal')
    review = read(old / 'source-audit/review.json')
    fields = read(old / 'source-audit/schema.json')['required']
    if (review.get('ready') is not False or review.get('releaseTargetBound') is not False
        or any(review.get(k) is not True for k in fields if k not in ('ready', 'releaseTargetBound', 'citations', 'findings'))
        or 'ios/.xcode.env.local' not in '\n'.join(review['findings'])):
        raise RuntimeError('environment-recovery-other-audit-refusal')
    end = read(root / 'logs/convex/end.json')
    if (end['outcome'] != 'builder-ended' or end['exitCode'] != 0 or end['lastMilestone'] != 'm8'
        or not end['cleanup']['complete'] or not end['derivedDataCleanup']['complete']):
        raise RuntimeError('environment-recovery-completed-builder-required')
    custody = root / 'attempts/convex-builder-completed'
    if inventory(custody) != read(old / 'custody.clone.json'):
        raise RuntimeError('environment-recovery-custody-drift')
    env = custody / 'ios/.xcode.env.local'
    if env.read_text() != 'export NODE_BINARY=/opt/homebrew/Cellar/node/26.9.0/bin/node\n':
        raise RuntimeError('environment-recovery-unexpected-local-env')
    return {'originalContent': env.read_text(), 'originalSha256': sha(env),
            'auditSha256': sha(old / 'source-audit/review.json')}

def capture(root):
    root = Path(root).resolve(); original = facts(root)
    chains = {p.name: inventory(p) for p in sorted((root / 'logs').glob('chain-*'))}
    if not chains or any(not (root / 'logs' / n / 'end.json').exists() for n in chains):
        raise RuntimeError('environment-recovery-chain-not-stopped')
    target = root / LOCATION; target.mkdir()
    work = Path(read(root / OLD / 'scratch.json')['path']) / 'app'
    trees = {'attempt': root / OLD, 'work': work, 'lane': root / 'lanes/convex',
             'custody': root / 'attempts/convex-builder-completed',
             'snapback4-results': root / 'results/snapback4'}
    manifests = {}
    for name, tree in trees.items():
        put(target / (name + '.json'), {'path': str(tree), 'inventory': inventory(tree)})
        manifests[name + '.json'] = sha(target / (name + '.json'))
    put(target / 'chains.json', chains); manifests['chains.json'] = sha(target / 'chains.json')
    put(target / 'RECLASSIFICATION.json', {
        'classification': 'harness-defect-environment-leak', 'backend': 'convex',
        'authority': 'User Lane P3 Round 2, 2026-10-07: machine-local CocoaPods env is operator setup',
        'outcomeClass': 'operator-setup', 'productOutcome': None, 'setupRerunsConsumed': 0,
        'originalAttempt': OLD, 'original': original,
        'previousPacketSha256': sha(root / 'PACKET.sha256'), 'priorChains': sorted(chains),
        'builderEndSha256': sha(root / 'logs/convex/end.json'), 'manifests': manifests,
        'continuation': 'Unchanged custody, fresh work copy, pinned generated env, both audits, semantic handoff, Release build, M6 and M8',
        'at': time.time()})
    readonly(target)
    return {'path': LOCATION + '/RECLASSIFICATION.json', 'sha256': sha(target / 'RECLASSIFICATION.json')}

def verify_record(root):
    root = Path(root).resolve(); target = root / LOCATION
    binding = read(root / 'metadata/revision-11.json')['reclassification']
    if binding['path'] != LOCATION + '/RECLASSIFICATION.json' or sha(root / binding['path']) != binding['sha256']:
        raise RuntimeError('environment-recovery-binding')
    value = read(root / binding['path'])
    if (value['classification'], value['backend'], value['outcomeClass'], value['setupRerunsConsumed'], value['productOutcome']) != (
            'harness-defect-environment-leak', 'convex', 'operator-setup', 0, None):
        raise RuntimeError('environment-recovery-disposition')
    if (sha(root / 'PACKET.v10.sha256') != value['previousPacketSha256']
        or sha(root / 'logs/convex/end.json') != value['builderEndSha256'] or facts(root) != value['original']):
        raise RuntimeError('environment-recovery-evidence-drift')
    if set(value['manifests']) != {'attempt.json', 'work.json', 'lane.json', 'custody.json', 'snapback4-results.json', 'chains.json'}:
        raise RuntimeError('environment-recovery-manifests-missing')
    for name, digest in value['manifests'].items():
        if sha(target / name) != digest: raise RuntimeError('environment-recovery-manifest-drift')
        data = read(target / name)
        if name == 'chains.json':
            for chain, inv in data.items():
                if inventory(root / 'logs' / chain) != inv: raise RuntimeError('environment-recovery-chain-drift')
        elif inventory(Path(data['path'])) != data['inventory']:
            raise RuntimeError('environment-recovery-retained-drift:' + name)
    return {**binding, 'priorChains': value['priorChains'], 'setupRerunsConsumed': 0,
            'order': ['convex-after-builder']}

def admission(root):
    receipt = verify_record(root)
    if sorted(p.name for p in (root / 'logs').glob('chain-*')) != receipt['priorChains']:
        raise RuntimeError('environment-recovery-already-consumed')
    if sorted(p.name for p in (root / 'results/convex').glob('attempt-*')) != ['attempt-01']:
        raise RuntimeError('environment-recovery-measurement-already-started')
    from processes import ProcessOwner
    if ProcessOwner.resume(root / 'logs/convex').sample(persist=False):
        raise RuntimeError('environment-recovery-live-builder')
    for backend in BACKENDS: free_ports(backend)
    return receipt

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(); parser.add_argument('--capture', action='store_true')
    args = parser.parse_args(); host_check()
    leases = [lock('chain.lock'), lock('authoring-or-operator.lock')]
    print(json.dumps(capture(ROOT) if args.capture else admission(ROOT)))
