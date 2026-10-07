"""Sealed admission for completed SB4 authoring terminated at replay-start.

Historical failure and product evidence stay intact. No successful builder exit,
replay, report, native verdict, or setup rerun is invented.
"""
import re
from common import *
from processes import ProcessOwner, booted_simulators, simulator_targets
import derived_data

LOCATION = 'attempts/snapback4-replay-boundary-reclassified'
DEFECT = 'M6-only-replay-start-after-M8'
MISSING = 'not-executed (harness defect)'

def stat_inventory(root):
    result = {}
    def walk(p):
        s = p.lstat()
        result[str(p.relative_to(root))] = {'device': s.st_dev, 'inode': s.st_ino,
            'mtimeNs': s.st_mtime_ns, 'ctimeNs': s.st_ctime_ns}
        if p.is_dir() and not p.is_symlink():
            for child in sorted(p.iterdir()): walk(child)
    walk(root)
    return result

def facts(root):
    logs = root / 'logs/snapback4'; lane = root / 'lanes/snapback4'
    end = read(logs / 'end.json')
    if (end['outcome'], end['reason'], end['lastMilestone'], end['exitCode']) != (
            'setup-failure', 'invalid-replay-boundary', 'm8', -15):
        raise RuntimeError('reclassification-wrong-termination')
    if end['termination']['reason'] != 'invalid-replay-boundary':
        raise RuntimeError('reclassification-wrong-termination')
    if not end['cleanup']['complete'] or not end['derivedDataCleanup']['complete']:
        raise RuntimeError('reclassification-cleanup-incomplete')
    requests = [json.loads(x) for x in (logs / 'boundary-requests.jsonl').read_text().splitlines()]
    if [x['phase'] for x in requests] != [*MILESTONES[1:], 'replay-start']:
        raise RuntimeError('reclassification-wrong-boundaries')
    terminals = re.findall(r'^(\d+) milestone=(m\d+) terminal=green\b', (lane / 'run-log.md').read_text(), re.M)
    if [m for _, m in terminals] != list(MILESTONES):
        raise RuntimeError('reclassification-authoring-incomplete')
    at = int(terminals[-1][0]); replay_at = requests[-1]['at']
    if not at < replay_at <= end['termination']['observedAt'] <= end['at']:
        raise RuntimeError('reclassification-time-order')
    if any((lane / name).exists() for name in ('essay.md', 'final-report.md')):
        raise RuntimeError('reclassification-report-presence-mismatch')
    events = [json.loads(x) for x in (logs / 'watchdog.jsonl').read_text().splitlines()]
    if any(e.get('phase') in ('replay-start', 'replay-end') for e in events):
        raise RuntimeError('reclassification-replay-already-admitted')
    if any(n >= 2000000 for n in read(logs / 'phase-token-sampling.json')['tokens'].values()):
        raise RuntimeError('reclassification-token-cap')
    return {'authoringTerminal': {'milestone': 'm8', 'terminal': 'green', 'at': at},
        'harnessTermination': {'boundary': 'replay-start', 'requestedAt': replay_at,
            'observedAt': end['termination']['observedAt'], 'completedAt': end['at'], 'exitCode': -15}}

def live_cleanup(root, backend='snapback4'):
    logs = root / 'logs' / backend; end = read(logs / 'end.json')
    owner = ProcessOwner.resume(logs)
    if owner.sample(persist=False): raise RuntimeError('reclassification-live-builder-process')
    if simulator_targets(owner.state['simulatorsBefore'], booted_simulators()):
        raise RuntimeError('reclassification-simulator-cleanup-drift')
    if (root / 'runtime/derived-data-active.json').exists():
        raise RuntimeError('reclassification-derived-data-active')
    cleanup = end['derivedDataCleanup']; before = read(logs / 'derived-data-before.json')
    if derived_data.listing(Path(before['root'])) != cleanup['remaining']:
        raise RuntimeError('reclassification-derived-data-baseline-drift')
    quarantine = root / ('runtime/builder-' + backend + '/derived-data')
    after = read(logs / 'derived-data-after.json')
    if derived_data.listing(quarantine) != {k: after[k] for k in cleanup['created']}:
        raise RuntimeError('reclassification-quarantine-drift')
    if derived_data.manifest_setting() != before['manifestSandboxBefore']:
        raise RuntimeError('reclassification-xcode-setting-drift')
    for backend in BACKENDS: free_ports(backend)
    return {'complete': True, 'processes': 'none owned live', 'ports': 'both lane ranges free',
        'derivedData': 'baseline and quarantine identities unchanged', 'checkedAt': time.time()}

def capture(root):
    root = Path(root).resolve(); target = root / LOCATION
    value = facts(root); cleanup = live_cleanup(root)
    target.mkdir()
    trees = {'lane': 'lanes/snapback4', 'logs': 'logs/snapback4',
             'quarantine': 'runtime/builder-snapback4/derived-data'}
    manifests = {}
    for key, name in trees.items():
        path = root / name; stats = stat_inventory(path)
        if key in ('lane', 'quarantine') and any(max(s['mtimeNs'], s['ctimeNs']) / 1e9 >
                value['harnessTermination']['completedAt'] for s in stats.values()):
            raise RuntimeError('reclassification-post-termination-mutation:' + key)
        inv = inventory(path)
        if stat_inventory(path) != stats: raise RuntimeError('reclassification-capture-race:' + key)
        put(target / (key + '.json'), {'tree': name, 'inventory': inv, 'stats': stats})
        manifests[key + '.json'] = sha(target / (key + '.json'))
    chains = {p.name: inventory(p) for p in sorted((root / 'logs').glob('chain-*'))}
    put(target / 'chains.json', chains); manifests['chains.json'] = sha(target / 'chains.json')
    value.update(classification='completed-authoring-harness-defect', defect=DEFECT, backend='snapback4',
        setupRerunsConsumed=0, O5=MISSING,
        missingReports={name: 'absent (harness defect)' for name in ('essay.md', 'final-report.md')},
        productEvidence='retained; admitted to normal native measurement; outcome pending',
        nativeMeasurement='unchanged custody, source audits, Release build, M6/M8 driver and independent validation',
        asymmetry='Snapback 4 has no replay or essay/final-report because of the harness defect; Convex runs unchanged with the fixed replay rule. Native measurement is unaffected.',
        packetV3Sha256=sha(root / 'PACKET.v3.sha256'), priorChains=sorted(chains),
        retainedManifests=manifests, cleanupVerification=cleanup,
        custodyBasis='No termination-time content manifest existed. Filesystem change/modification times precede the recorded end; complete hashes and inode/time witnesses captured now and rechecked before custody.',
        authority='User Lane P2A Round 3: measure completed SB4, do not void; no setup rerun consumed',
        at=time.time())
    put(target / 'RECLASSIFICATION.json', value)
    put(target / 'RECLASSIFICATION.md', '# Completed Snapback 4 authoring retained for measurement\n\n'
        'M1–M6 and M8 are green. M8 terminal: 1791231956. Replay-start request: '
        '1791231965.8406022; supervisor observed rejection: 1791231966.363043; '
        'cleanup/end: 1791231969.0148532. The M6-only execution restriction is a harness defect; '
        'the inherited instrument places adapter authoring inside M6 and execution on a separate clock.\n\n'
        'O5: not-executed (harness defect). essay.md and final-report.md: absent for the same reason. '
        'No setup rerun consumed. Historical logs and builder tree are unchanged. Product evidence '
        'is retained and admitted to the ordinary custody/build/native measurement path. '
        'This is neither a void nor a native pass. Convex retains its original prompt/inputs and '
        'runs with the corrected single-interval replay rule; this replay/report asymmetry is disclosed.\n\n'
        'See RECLASSIFICATION.json for bound evidence, timing distinctions and custody limits.\n')
    readonly(target)
    return {'path': str((target / 'RECLASSIFICATION.json').relative_to(root)),
            'sha256': sha(target / 'RECLASSIFICATION.json')}

def verify_record(root, path=None, live=True):
    root = Path(root).resolve()
    binding = read(root / 'metadata/revision-4.json')['reclassification']
    expected = root / LOCATION / 'RECLASSIFICATION.json'
    if binding['path'] != str(expected.relative_to(root)) or (path is not None and (root / path).resolve() != expected):
        raise RuntimeError('reclassification-path-binding')
    if sha(expected) != binding['sha256']: raise RuntimeError('reclassification-seal-binding')
    value = read(expected)
    if (value['classification'], value['defect'], value['backend'], value['setupRerunsConsumed'], value['O5']) != (
            'completed-authoring-harness-defect', DEFECT, 'snapback4', 0, MISSING):
        raise RuntimeError('reclassification-disposition')
    if sha(root / 'PACKET.v3.sha256') != value['packetV3Sha256']:
        raise RuntimeError('reclassification-prior-seal-drift')
    for key, fact in facts(root).items():
        if value[key] != fact: raise RuntimeError('reclassification-fact-drift:' + key)
    for name, digest in value['retainedManifests'].items():
        if name not in ('lane.json', 'logs.json', 'quarantine.json', 'chains.json') or sha(expected.parent / name) != digest:
            raise RuntimeError('reclassification-manifest-drift')
    if set(value['retainedManifests']) != {'lane.json', 'logs.json', 'quarantine.json', 'chains.json'}:
        raise RuntimeError('reclassification-manifest-missing')
    for name in ('lane', 'logs', 'quarantine'):
        manifest = read(expected.parent / (name + '.json')); tree = root / manifest['tree']
        if stat_inventory(tree) != manifest['stats'] or inventory(tree) != manifest['inventory']:
            raise RuntimeError('reclassification-custody-drift:' + name)
    chains = read(expected.parent / 'chains.json')
    if sorted(chains) != value['priorChains']: raise RuntimeError('reclassification-chain-list')
    for name, inv in chains.items():
        if inventory(root / 'logs' / name) != inv or read(root / 'logs' / name / 'end.json')['exitCode'] != 2:
            raise RuntimeError('reclassification-prior-chain-drift')
    if live: live_cleanup(root)
    return {**binding, 'classification': value['classification'], 'O5': value['O5'],
        'missingReports': value['missingReports'], 'setupRerunsConsumed': 0, 'asymmetry': value['asymmetry']}

RECOVERY = 'attempts/snapback4-work-copy-refusal'

def capture_custody_refusal(root):
    root = Path(root).resolve()
    original = verify_record(root)
    attempt = root / 'results/snapback4/attempt-01'
    summary = read(attempt / 'summary.json')
    if (summary.get('reason') != 'external-work-copy-symlink:evidence/native-adapter-store/node_modules'
        or summary.get('failureStage') != 'operator-setup' or summary.get('segments') != {}
        or summary.get('observedProductFailure') is not False):
        raise RuntimeError('not-premeasurement-internal-link-refusal')
    if any((attempt / n).exists() for n in ('source-audit', 'prepare.log', 'release-build.log', 'm6', 'm8')):
        raise RuntimeError('custody-recovery-cannot-retry-execution')
    target = root / RECOVERY; target.mkdir()
    snapshot = root / 'attempts/snapback4-builder-completed'
    lane = read(root / LOCATION / 'lane.json')['inventory']
    if inventory(snapshot) != lane or read(attempt / 'custody.clone.json') != lane:
        raise RuntimeError('custody-recovery-snapshot-drift')
    link = root / 'lanes/snapback4/evidence/native-adapter-store/node_modules'
    if not link.is_symlink() or link.resolve() != (root / 'lanes/snapback4/node_modules').resolve():
        raise RuntimeError('custody-recovery-link-not-internal')
    prior = read(root / LOCATION / 'RECLASSIFICATION.json')['priorChains']
    chains = sorted((root / 'logs').glob('chain-*'))
    extra = [p for p in chains if p.name not in prior]
    if len(extra) != 1 or read(extra[0] / 'end.json')['exitCode'] != 2:
        raise RuntimeError('custody-recovery-chain-state')
    if read(extra[0] / 'resume.json')['sha256'] != original['sha256']:
        raise RuntimeError('custody-recovery-chain-binding')
    steps = [json.loads(x) for x in (extra[0] / 'steps.jsonl').read_text().splitlines()]
    if [(x['backend'], x['script'], x['kind']) for x in steps] != [
            ('snapback4', 'after-builder.sh', 'start'), ('snapback4', 'after-builder.sh', 'end')]:
        raise RuntimeError('custody-recovery-downstream-execution')
    # Retain every failed attempt and clone. No source or native measurement ran.
    (root / 'results/snapback4').rename(target / 'results')
    snapshot.rename(target / 'custody')
    kept = {name: inventory(target / name) for name in ('results', 'custody')}
    kept['chain'] = inventory(extra[0])
    put(target / 'retained.json', kept)
    put(target / 'RECOVERY.json', {'classification': 'premeasurement-harness-custody-refusal',
        'reclassificationSha256': original['sha256'], 'priorChains': [p.name for p in chains],
        'refusedChain': extra[0].name, 'retainedSha256': sha(target / 'retained.json'),
        'packetSha256': sha(root / 'PACKET.sha256'), 'setupRerunsConsumed': 0,
        'reason': 'APFS copied a lane-internal absolute dependency link verbatim; relocate inside the work copy only.',
        'productExecutionStarted': False, 'at': time.time()})
    for name in ('RECOVERY.json', 'retained.json'): (target / name).chmod(0o444)
    target.chmod(0o555)
    return {'path': RECOVERY + '/RECOVERY.json', 'sha256': sha(target / 'RECOVERY.json')}

def verify_custody_recovery(root):
    binding = read(root / 'metadata/revision-4.json').get('custodyRecovery')
    if binding is None: return None
    target = root / RECOVERY
    if binding['path'] != RECOVERY + '/RECOVERY.json' or sha(target / 'RECOVERY.json') != binding['sha256']:
        raise RuntimeError('custody-recovery-binding')
    value = read(target / 'RECOVERY.json')
    if (value['classification'] != 'premeasurement-harness-custody-refusal' or
        value['setupRerunsConsumed'] != 0 or value['productExecutionStarted'] is not False or
        value['reclassificationSha256'] != sha(root / LOCATION / 'RECLASSIFICATION.json')):
        raise RuntimeError('custody-recovery-disposition')
    if sha(target / 'retained.json') != value['retainedSha256']:
        raise RuntimeError('custody-recovery-manifest-drift')
    kept = read(target / 'retained.json')
    for name in ('results', 'custody'):
        if inventory(target / name) != kept[name]: raise RuntimeError('custody-recovery-retained-drift')
    if inventory(root / 'logs' / value['refusedChain']) != kept['chain']:
        raise RuntimeError('custody-recovery-chain-drift')
    return {**binding, 'priorChains': value['priorChains'], 'setupRerunsConsumed': 0}

def admission(root, path):
    root = Path(root).resolve()
    receipt = verify_record(root, path)
    prior = sorted(p.name for p in (root / 'logs').glob('chain-*'))
    recovery = verify_custody_recovery(root)
    expected = recovery['priorChains'] if recovery else read(root / path)['priorChains']
    if prior != expected: raise RuntimeError('reclassification-already-consumed')
    if recovery: receipt['custodyRecovery'] = recovery
    if (root / 'results/snapback4').exists() or (root / 'attempts/snapback4-builder-completed').exists():
        raise RuntimeError('reclassification-measurement-already-started')
    if (root / 'logs/convex').exists() or (root / 'results/convex').exists() or sorted(
            p.name for p in (root / 'lanes/convex').iterdir()) != ['instrument']:
        raise RuntimeError('reclassification-convex-not-cold')
    return {**receipt, 'priorChains': prior, 'at': time.time(),
            'steps': ['snapback4/after-builder.sh', 'convex/launch-builder.sh', 'convex/after-builder.sh']}

if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser(); p.add_argument('--capture', action='store_true'); p.add_argument('--admission', action='store_true'); p.add_argument('--capture-custody-refusal', action='store_true')
    a = p.parse_args(); host_check()
    if a.capture_custody_refusal:
        lease = lock('chain.lock'); operator = lock('authoring-or-operator.lock')
        print(json.dumps(capture_custody_refusal(ROOT)))
    elif a.capture:
        lease = lock('chain.lock'); operator = lock('authoring-or-operator.lock')
        print(json.dumps(capture(ROOT)))
    elif a.admission: print(json.dumps(admission(ROOT, LOCATION + '/RECLASSIFICATION.json')))
    else: print(json.dumps(verify_record(ROOT)))
