"""One-use continuation of the retained wrapper-rule harness refusal."""
from common import *
from round5 import verify_record as verify_authoring

LOCATION = 'attempts/convex-wrapper-refusal-reclassified'
OLD = 'results/convex/attempt-01'
DEFECT = 'build-wrapper-requires-derived-and-dedicated-udid'


def capture(root):
    old = root / OLD; summary = read(old / 'summary.json')
    if (summary.get('reason') != DEFECT or summary.get('failureStage') != 'builder-handoff'
        or summary.get('segments') or summary.get('observedProductFailure')
        or any((old / name).exists() for name in ('source-audit', 'prepare.log', 'release-build.log'))):
        raise RuntimeError('round6-not-the-unaudited-wrapper-refusal')
    authoring = verify_authoring(root)
    target = root / LOCATION; target.mkdir()
    work = Path(read(old / 'scratch.json')['path']) / 'app'
    put(target / 'work.json', inventory(work))
    chains = {p.name: inventory(p) for p in sorted((root / 'logs').glob('chain-*'))}
    if any(not (root / 'logs' / name / 'end.json').exists() for name in chains):
        raise RuntimeError('round6-prior-chain-running')
    put(target / 'chains.json', chains)
    value = {'classification': 'harness-defect-refusal', 'defect': DEFECT,
        'authority': 'User Lane P2A Round 6', 'backend': 'convex', 'setupRerunsConsumed': 0,
        'productOutcome': None, 'originalAttempt': OLD, 'originalAttemptInventory': inventory(old),
        'work': str(work), 'workManifestSha256': sha(target / 'work.json'),
        'chainManifestSha256': sha(target / 'chains.json'), 'priorChains': sorted(chains),
        'previousPacketSha256': sha(root / 'PACKET.sha256'), 'authoringAdmission': authoring,
        'snapback4DiagnosticRerun': False,
        'reason': 'Wrapper admission changed; SB4 already passed build and still hits its unchanged fixture-compose-nonce defect.',
        'at': time.time()}
    put(target / 'RECLASSIFICATION.json', value); readonly(target)
    return {'path': LOCATION + '/RECLASSIFICATION.json', 'sha256': sha(target / 'RECLASSIFICATION.json')}


def verify_record(root):
    binding = read(root / 'metadata/revision-7.json')['reclassification']
    target = root / LOCATION
    if binding['path'] != LOCATION + '/RECLASSIFICATION.json' or sha(root / binding['path']) != binding['sha256']:
        raise RuntimeError('round6-reclassification-binding')
    value = read(root / binding['path'])
    if (value['classification'], value['defect'], value['setupRerunsConsumed'], value['productOutcome'],
        value['snapback4DiagnosticRerun']) != ('harness-defect-refusal', DEFECT, 0, None, False):
        raise RuntimeError('round6-reclassification-disposition')
    if sha(root / 'PACKET.v6.sha256') != value['previousPacketSha256']:
        raise RuntimeError('round6-prior-seal-drift')
    if inventory(root / OLD) != value['originalAttemptInventory']:
        raise RuntimeError('round6-original-attempt-drift')
    for name, key in [('work.json', 'workManifestSha256'), ('chains.json', 'chainManifestSha256')]:
        if sha(target / name) != value[key]: raise RuntimeError('round6-manifest-drift:' + name)
    if inventory(Path(value['work'])) != read(target / 'work.json'):
        raise RuntimeError('round6-retained-work-drift')
    if inventory(root / 'attempts/convex-builder-completed') != read(root / OLD / 'custody.clone.json'):
        raise RuntimeError('round6-custody-drift')
    for name, inv in read(target / 'chains.json').items():
        if inventory(root / 'logs' / name) != inv: raise RuntimeError('round6-prior-chain-drift')
    verify_authoring(root)
    return {**binding, 'classification': value['classification'], 'setupRerunsConsumed': 0,
            'priorChains': value['priorChains'], 'order': ['convex-after-builder'],
            'snapback4DiagnosticRerun': False}


def admission(root):
    receipt = verify_record(root)
    static = read(root / 'metadata/revision-7.json')['staticAdmission']
    if static['path'] != 'metadata/round6-static.json' or sha(root / static['path']) != static['sha256']:
        raise RuntimeError('round6-static-admission-binding')
    reports = read(root / static['path'])
    if not reports['convex']['valid'] or not reports['snapback4FreshProjection']['valid']:
        raise RuntimeError('round6-static-admission-refused')
    if sorted(p.name for p in (root / 'logs').glob('chain-*')) != receipt['priorChains']:
        raise RuntimeError('round6-already-consumed')
    if sorted(p.name for p in (root / 'results/convex').glob('attempt-*')) != ['attempt-01']:
        raise RuntimeError('round6-measurement-already-started')
    return receipt


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser(); p.add_argument('--capture', action='store_true')
    args = p.parse_args(); host_check()
    leases = [lock('chain.lock'), lock('authoring-or-operator.lock')]
    print(json.dumps(capture(ROOT) if args.capture else admission(ROOT)))
