#!/usr/bin/env python3
"""Exercise archival coverage and privacy on an isolated synthetic packet."""
import hashlib
import importlib.util
import json
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parent
tool = root / 'm7-custody-observer.py'
spec = importlib.util.spec_from_file_location('m7_observer_check', tool)
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)

with tempfile.TemporaryDirectory(prefix='m7-observer-v3-check-') as temp:
    base = Path(temp)
    packet = base / 'packet'
    lane = packet / 'lanes/astra-snapback4'
    logs = packet / 'logs'
    for path in [lane / 'm7/pre-snapshot', lane / 'evidence', lane / 'packages/app',
                 lane / 'schema', lane / 'ui-kit', lane / 'node_modules', logs]:
        path.mkdir(parents=True, exist_ok=True)
    observer.PACKET = packet
    observer.ROOT = base / 'custody'
    snapshot = lane / 'm7/pre-snapshot/alice.json'
    receipt = lane / 'receipts-all7.jsonl'
    first = b'{"messages":["before"]}\n'
    second = b'{"messages":["after"]}\n'
    receipt_first = b'{"assertion":"m7-a01","result":"fail"}\n'
    receipt_second = b'{"assertion":"m7-a01","result":"pass"}\n'
    snapshot.write_bytes(first)
    receipt.write_bytes(receipt_first)
    (lane / 'evidence/sensitive.json').write_text('{"token":"synthetic-private-sentinel"}\n')
    (lane / 'credentials.json').write_text('{"ignored":true}\n')
    source = b'export const observerFixture = 92741;\n'
    for name in ['packages/app/owned.ts', 'ui-kit/owned.ts', 'm7/probe.mjs']:
        (lane / name).write_bytes(source)
    (lane / 'schema/schema.q').write_text('query example(): return 1\n')
    (lane / 'package.json').write_text('{"name":"synthetic-fixture"}\n')
    (lane / 'node_modules/ignored.json').write_text('{"dependency":true}\n')
    (lane / 'evidence/link.json').symlink_to(lane / 'credentials.json')
    out = observer.ROOT / 'cell-custody-0.2.10/astra/m7-observer'
    errors = []

    def run():
        try:
            observer.observe('astra')
        except BaseException as error:
            errors.append(repr(error))

    thread = threading.Thread(target=run, daemon=True)
    thread.start()

    def wait_for(predicate):
        deadline = time.monotonic() + 15
        while not predicate():
            assert time.monotonic() < deadline, errors
            time.sleep(0.05)

    sha = lambda data: hashlib.sha256(data).hexdigest()
    wait_for(lambda: (out / 'objects' / sha(receipt_first)).exists())
    snapshot.write_bytes(second)
    receipt.write_bytes(receipt_second)
    wait_for(lambda: (out / 'objects' / sha(receipt_second)).exists())
    end = logs / 'astra-snapback4.m7.end.json'
    end.write_text('{"exitCode":0}\n')
    expected = {str(p.relative_to(packet)): sha(p.read_bytes()) for p in packet.rglob('*')
                if p.is_file() and not p.is_symlink()}
    thread.join(15)
    assert not thread.is_alive() and not errors, errors
    events = [json.loads(line) for line in (out / 'events.jsonl').read_text().splitlines()]
    sources = [json.loads(p.read_text())['sources'] for p in (out / 'source-versions').glob('*.json')]
    source_paths = set().union(*(set(value) for value in sources))
    objects = {p.name for p in (out / 'objects').iterdir()}
    checks = {
        'both_snapshot_versions_retained': {sha(first), sha(second)} <= objects,
        'both_root_receipt_versions_retained': {sha(receipt_first), sha(receipt_second)} <= objects,
        'sensitive_evidence_hash_only': any(e.get('path') == 'evidence/sensitive.json' and not e['copied'] for e in events),
        'excluded_names_symlinks_dependencies': not any(e.get('path') in {'credentials.json', 'evidence/link.json', 'node_modules/ignored.json'} for e in events),
        'source_coverage': {'packages/app/owned.ts', 'ui-kit/owned.ts', 'm7/probe.mjs', 'schema/schema.q', 'package.json'} <= source_paths,
        'source_contents_hash_only': sha(source) not in objects,
        'root_configuration_not_copied': sha((lane / 'package.json').read_bytes()) not in objects,
        'stops_after_phase_end': json.loads((out / 'end.json').read_text())['reason'] == 'phase-end-present',
        'packet_inputs_unmodified': all(sha((packet / name).read_bytes()) == digest for name, digest in expected.items()),
    }
    assert all(checks.values()), checks
    report = {'checkedAt': datetime.now(timezone.utc).isoformat(),
              'method': 'Temporary synthetic packet only; no real packet reads, writes or process signals. Preserves both replaced snapshot and root receipt versions; checks exclusions, source scope and phase-end stop.',
              'observerSha256': sha(tool.read_bytes()), 'checks': checks}
    path = root / 'm7-observer-v3-checks.json'
    assert not path.exists(), 'Preserve the prior check receipt'
    path.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
