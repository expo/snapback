"""A restart is exceptional, explicit, and bound to retained void custody."""
from common import *

def admission(root, void=None):
    root = Path(root).resolve()
    prior = sorted((root / 'logs').glob('chain-*'))
    if not prior:
        if void: raise RuntimeError('restart-without-prior-chain')
        return None
    if void is None: raise RuntimeError('prior-chain-requires-explicit-VOID-record')
    path = (root / void).resolve()
    if path.parent != (root / 'attempts').resolve(): raise RuntimeError('void-must-be-retained-in-attempts')
    value = read(path / 'VOID.json')
    if not (path / 'VOID.md').read_text().strip() or value.get('classification') != 'harness-defect-void':
        raise RuntimeError('invalid-VOID-record')
    if value.get('setupRerunsConsumed') != 0 or value.get('productOutcome') is not None:
        raise RuntimeError('invalid-VOID-accounting')
    if value.get('priorChains') != [p.name for p in prior]: raise RuntimeError('VOID-does-not-cover-prior-chains')
    if any(not (p / 'end.json').exists() for p in prior): raise RuntimeError('prior-chain-not-ended')
    expected = read(path / 'retained-inventory.json')
    for name in ['logs', 'lanes', 'results']:
        if inventory(path / name) != expected[name]: raise RuntimeError('void-custody-drift:' + name)
    for old in prior:
        if inventory(old) != inventory(path / 'logs' / old.name): raise RuntimeError('void-chain-binding')
    for b in value['backends']:
        if (root / 'logs' / b).exists() or (root / 'results' / b).exists():
            raise RuntimeError('prior-active-attempt-not-archived')
    if sha(root / 'PACKET.v1.sha256') != value['packetV1Sha256']:
        raise RuntimeError('void-packet-binding')
    return {'void': str(path.relative_to(root)), 'voidSha256': sha(path / 'VOID.json'),
            'recordSha256': sha(path / 'VOID.md'), 'priorChains': value['priorChains'],
            'setupRerunsConsumed': 0, 'at': time.time()}
