"""App-owned unmeasured outcomes and one-use continuation of the retained build."""
from common import *

OLD = 'results/snapback4/attempt-02'
LOCATION = 'attempts/snapback4-m6-app-setup'
ORDER = ['snapback4-m8-same-build', 'convex-builder', 'convex-after-builder']
# @ref LLP 0201.000#4 — keep assertion nulls; chain attribution is separate.
APP_PRIME_REASONS = {
    'selector-not-hittable', 'sign-in', 'authentication-restore',
    'app-exited-during-startup', 'app-not-running-after-launch',
    'media-load-missing', 'media-pixels-node-missing', 'placeholder-or-wrong-media-pixels',
    'prime-consumption',
}

def app_setup_failure(status, failure):
    """Only an observed app failure can turn raw setup into a terminal app result.

    Unknown setup, host errors and instrument errors stay blocking. The frozen
    driver reports a startup-video endpoint shortfall after an app has already
    failed; that limits video evidence but cannot erase the observed app failure.
    """
    failure = failure or {}
    reason = failure.get('reason', '')
    if (status.get('pass') is not None or failure.get('outcomeClass') != 'setup'
        or reason != status.get('reason')
        or not (reason in APP_PRIME_REASONS or reason.startswith('fixture-row-not-found:'))):
        return False
    state = failure.get('appState', {}).get('state')
    if state not in ('foreground', 'not-running'): return False
    if state == 'not-running' and reason not in ('app-exited-during-startup', 'app-not-running-after-launch'):
        return False
    return all(x.get('outcomeClass') == 'instrument' and
        x.get('reason') == 'invalid-startup-video:video-endpoint-uncovered'
        for x in failure.get('secondaryFailures', []))

def facts(root):
    old = root / OLD; summary = read(old / 'summary.json')
    status = read(old / 'm6/evidence/status.json')
    failure = read(old / 'm6/evidence/m6-ios-run.json')['failure']
    validation = read(old / 'm6/independent-validation.json')
    if (set(summary['segments']) != {'m6'} or (old / 'm8').exists()
        or not summary.get('cleanupComplete') or summary.get('cleanupErrors')
        or validation.get('exitCode') != 0 or validation.get('valid') is not True
        or validation.get('pass') is not None or not app_setup_failure(status, failure)):
        raise RuntimeError('product-resume-app-failure-evidence-required')
    for name in ('source-audit', 'prepared-source-audit'):
        if read(old / name / 'review.json').get('ready') is not True:
            raise RuntimeError('product-resume-passing-audits-required')
    if read(old / 'semantic-handoff/result.json').get('pass') is not True:
        raise RuntimeError('product-resume-passing-handoff-required')
    return {'status': status, 'failure': failure, 'validation': validation}

def input_inventory(work):
    # Build/preparation outputs are not rewritten on resume. Bind the retained
    # authored inputs and installed dependencies, excluding unrelated old stores.
    names = ['src', 'app', 'scripts', 'vendor', 'snapback', 'native-fixtures', 'node_modules',
             'native-operator.json', 'package.json', 'package-lock.json', 'app.json', 'dist']
    return {n: inventory(work / n) for n in names if (work / n).exists()}

def capture(root):
    root = Path(root).resolve(); observed = facts(root)
    if (root / 'logs/convex').exists() or (root / 'results/convex').exists():
        raise RuntimeError('product-resume-convex-already-started')
    chains = {p.name: inventory(p) for p in sorted((root / 'logs').glob('chain-*'))}
    if not chains or any(not (root / 'logs' / n / 'end.json').exists() for n in chains):
        raise RuntimeError('product-resume-chain-still-running')
    old = root / OLD; work = Path(read(old / 'scratch.json')['path']) / 'app'
    target = root / LOCATION; target.mkdir()
    put(target / 'retained.json', {'attempt': inventory(old), 'chains': chains,
        'work': str(work), 'inputs': input_inventory(work)})
    put(target / 'DISPOSITION.json', {'authority': 'Lane P3 Round 1 user ruling, 2026-10-07',
        'backend': 'snapback4', 'originalAttempt': OLD, 'disposition': 'app-unmeasured',
        'assertionPass': None, 'attribution': 'application', 'productRetry': False,
        'setupRerunsConsumed': 0, 'priorChains': sorted(chains), 'order': ORDER,
        'observed': observed, 'previousPacketSha256': sha(root / 'PACKET.sha256'),
        'retainedSha256': sha(target / 'retained.json'),
        'diagnosisSha256': sha(root / 'preparation/revision10/DIAGNOSIS.md'),
        'buildIdentity': read(old / 'release-identity.json'), 'at': time.time()})
    readonly(target)
    return {'path': LOCATION + '/DISPOSITION.json', 'sha256': sha(target / 'DISPOSITION.json')}

def verify_record(root):
    root = Path(root).resolve(); target = root / LOCATION
    binding = read(root / 'metadata/revision-10.json')['disposition']
    if binding['path'] != LOCATION + '/DISPOSITION.json' or sha(root / binding['path']) != binding['sha256']:
        raise RuntimeError('product-resume-binding-drift')
    value = read(root / binding['path'])
    if (value['originalAttempt'] != OLD or value['disposition'] != 'app-unmeasured'
        or value['assertionPass'] is not None or value['attribution'] != 'application'
        or value['productRetry'] is not False or value['setupRerunsConsumed'] != 0
        or value['order'] != ORDER or value['observed'] != facts(root)
        or value['previousPacketSha256'] != sha(root / 'PACKET.v9.sha256')
        or value['diagnosisSha256'] != sha(root / 'preparation/revision10/DIAGNOSIS.md')
        or value['retainedSha256'] != sha(target / 'retained.json')):
        raise RuntimeError('product-resume-disposition-drift')
    retained = read(target / 'retained.json')
    if inventory(root / OLD) != retained['attempt'] or input_inventory(Path(retained['work'])) != retained['inputs']:
        raise RuntimeError('product-resume-retained-drift')
    for name, inv in retained['chains'].items():
        if inventory(root / 'logs' / name) != inv: raise RuntimeError('product-resume-chain-drift')
    from after import app_hash, expand, handoff_mapping
    work = Path(retained['work'])
    build = expand(read(work / 'native-operator.json'), handoff_mapping('snapback4', work, work.parent))
    identity = value['buildIdentity']
    if app_hash(Path(build['app']), identity['bundleId']) != {k: identity[k] for k in ('bundleId', 'nativeSha256', 'hermesSha256')}:
        raise RuntimeError('product-resume-release-drift')
    if (work.parent / 'm8-store').exists(): raise RuntimeError('product-resume-m8-already-started')
    return {**binding, 'priorChains': value['priorChains'], 'order': ORDER, 'setupRerunsConsumed': 0}

def admission(root):
    root = Path(root).resolve(); receipt = verify_record(root)
    if sorted(p.name for p in (root / 'logs').glob('chain-*')) != receipt['priorChains']:
        raise RuntimeError('product-resume-already-consumed')
    if sorted(p.name for p in (root / 'results/snapback4').glob('attempt-*')) != ['attempt-01', 'attempt-02']:
        raise RuntimeError('product-resume-attempt-already-started')
    if ((root / 'logs/convex').exists() or (root / 'results/convex').exists()
        or sorted(p.name for p in (root / 'lanes/convex').iterdir()) != ['instrument']):
        raise RuntimeError('product-resume-convex-not-cold')
    from processes import ProcessOwner
    if ProcessOwner.resume(root / 'logs/snapback4').sample(persist=False):
        raise RuntimeError('product-resume-live-builder')
    for backend in BACKENDS: free_ports(backend)
    return receipt

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(); parser.add_argument('--capture', action='store_true')
    args = parser.parse_args(); host_check()
    leases = [lock('chain.lock'), lock('authoring-or-operator.lock')]
    print(json.dumps(capture(ROOT) if args.capture else admission(ROOT)))
