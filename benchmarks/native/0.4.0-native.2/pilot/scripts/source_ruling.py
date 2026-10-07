"""One-use Round 4 continuation, preserving the source refusal as a pilot finding."""
from common import *

OUTCOME = 'handoff-refused-by-source-audit'
LABEL = 'diagnostic: audit-refused, never admissible, no pass claimed'
DIAGNOSTIC = 'results/snapback4/diagnostic-audit-refused-never-admissible-no-pass-claimed'
REAUDIT = 'results/snapback4/re-audit-revision-5'
RULING = 'metadata/source-audit-ruling.json'

def diagnostic_profile(root):
    paths = [root / 'lanes', root / 'attempts/snapback4-builder-completed',
             root / 'results/snapback4/attempt-01', root / 'logs/snapback4', root / 'inputs']
    return '; ' + LABEL + '\n(version 1)\n(allow default)\n' + ''.join(
        '(deny file-write* (subpath ' + json.dumps(str(path.resolve())) + '))\n' for path in paths)

def protect_diagnostic():
    """Kernel write denial inherited by authored commands and the native driver."""
    path = ROOT / 'runtime/sb4-diagnostic-audit-refused-never-admissible.sb'
    put(path, diagnostic_profile(ROOT))
    return path

def capture(root):
    old = root / 'results/snapback4/attempt-01'
    summary = read(old / 'summary.json'); review = read(old / 'source-audit/review.json')
    if (summary.get('reason') != 'independent-source-audit-refused; see retained findings'
        or summary['segments'] or review['hooksPassive'] or review['oracleReadOnly']):
        raise RuntimeError('not-the-retained-two-blocker-source-refusal')
    work = Path(read(old / 'scratch.json')['path']) / 'app'
    prior = {p.name: inventory(p) for p in sorted((root / 'logs').glob('chain-*'))}
    if any(not (root / 'logs' / name / 'end.json').exists() for name in prior):
        raise RuntimeError('prior-chain-not-ended')
    put(root / RULING, {'authority': 'P2A Round 4 lead ruling, 2026-10-05',
        'nativeOutcome': OUTCOME, 'setupRerunsConsumed': 0, 'productRetry': False,
        'diagnosticLabel': LABEL, 'previousPacketSha256': sha(root / 'PACKET.sha256'),
        'originalAttempt': str(old.relative_to(root)), 'originalAttemptInventory': inventory(old),
        'priorChains': prior, 'work': str(work), 'originalFindings': review['findings'],
        'originalReviewSha256': sha(old / 'source-audit/review.json'),
        'laneManifest': str((old / 'custody.before.json').relative_to(root)),
        'custodyManifest': str((old / 'custody.clone.json').relative_to(root)),
        'workManifest': str((old / 'source-audit/source-binding.json').relative_to(root))})
    put(root / 'results/snapback4/native-outcome-round4.json', {
        'nativeOutcome': OUTCOME, 'pass': None, 'scoredUse': False, 'setupRerunsConsumed': 0,
        'void': False, 'setupFailure': False, 'originalFindings': review['findings'],
        'originalReviewSha256': sha(old / 'source-audit/review.json'),
        'authority': 'P2A Round 4 lead ruling', 'diagnosticLabel': LABEL})

def verify_retained(root, check_work=True):
    value = read(root / RULING)
    if value['nativeOutcome'] != OUTCOME or value['diagnosticLabel'] != LABEL:
        raise RuntimeError('source-ruling-disposition')
    if sha(root / 'PACKET.v4.sha256') != value['previousPacketSha256']:
        raise RuntimeError('source-ruling-prior-seal-drift')
    old = root / value['originalAttempt']
    if inventory(old) != value['originalAttemptInventory']:
        raise RuntimeError('source-ruling-original-audit-drift')
    trees = [(root / 'lanes/snapback4', value['laneManifest']),
             (root / 'attempts/snapback4-builder-completed', value['custodyManifest'])]
    if check_work: trees.append((Path(value['work']), value['workManifest']))
    for tree, manifest in trees:
        if inventory(tree) != read(root / manifest):
            raise RuntimeError('source-ruling-custody-drift:' + str(tree))
    for name, inv in value['priorChains'].items():
        if inventory(root / 'logs' / name) != inv: raise RuntimeError('source-ruling-chain-drift')
    return value

def admission(root):
    value = verify_retained(root)
    if sorted(p.name for p in (root / 'logs').glob('chain-*')) != sorted(value['priorChains']):
        raise RuntimeError('source-ruling-already-consumed')
    if sorted(p.name for p in (root / 'lanes/convex').iterdir()) != ['instrument']:
        raise RuntimeError('source-ruling-convex-not-cold')
    if (root / 'logs/convex').exists() or (root / 'results/convex').exists() or (root / DIAGNOSTIC).exists():
        raise RuntimeError('source-ruling-downstream-already-started')
    # Re-audit is recorded once before continuation, never silently skipped.
    result = read(root / REAUDIT / 'verdicts.json')
    if result['originalReviewSha256'] != value['originalReviewSha256']:
        raise RuntimeError('source-ruling-reaudit-original-binding')
    if result['reAuditReviewSha256'] != sha(root / REAUDIT / 'source-audit/review.json'):
        raise RuntimeError('source-ruling-reaudit-binding')
    return {'rulingSha256': sha(root / RULING), 'reAuditSha256': sha(root / REAUDIT / 'verdicts.json'),
            'nativeOutcome': OUTCOME, 'diagnosticLabel': LABEL, 'setupRerunsConsumed': 0,
            'order': ['convex-builder', 'convex-after-builder', 'snapback4-diagnostic']}

def reaudit(root):
    from audit import audit
    value = verify_retained(root)
    target = root / REAUDIT; target.mkdir()
    lease = lock('authoring-or-operator.lock')
    try:
        review = audit(Path(value['work']), target, gating=False)
        put(target / 'verdicts.json', {'originalReady': False, 'reAuditReady': review['ready'],
            'originalReviewSha256': value['originalReviewSha256'],
            'reAuditReviewSha256': sha(target / 'source-audit/review.json'),
            'reAuditQualified': read(target / 'source-audit/disposition.json')['qualified'],
            'twoBlockersRemain': review['hooksPassive'] is False and review['oracleReadOnly'] is False,
            'nativeOutcome': OUTCOME, 'productChanged': False, 'setupRerunsConsumed': 0})
    finally:
        lease.close()

def label_artifacts(attempt, scratch=None):
    """Bind every raw artifact without rewriting qualified driver/schema bytes.

    Mark the enclosing directory before execution; final per-path labels bind
    all files (including binaries, videos, logs and scratch) to exact hashes.
    """
    roots = {'artifacts': attempt}
    if scratch is not None: roots['scratch'] = scratch
    labeled = {}
    for name, path in roots.items():
        labeled[name] = {p: {**row, 'label': LABEL, 'admissible': False, 'passClaimed': False}
                         for p, row in inventory(path).items()}
    put(attempt / 'diagnostic-artifact-labels.json', {'label': LABEL, 'admissible': False,
        'passClaimed': False, 'roots': {k: str(v) for k, v in roots.items()}, 'artifacts': labeled,
        'note': 'Raw driver/validator booleans are instrument observations, never admissible pilot passes.'})

if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser(); p.add_argument('action', choices=['capture', 'reaudit', 'admission'])
    action = p.parse_args().action
    if action == 'capture': capture(ROOT)
    elif action == 'reaudit': reaudit(ROOT)
    else: print(json.dumps(admission(ROOT)))
