#!/usr/bin/env python3
"""Archive selected completed M7 evidence, retaining version and copy limits."""
import argparse
import hashlib
import importlib.util
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/Users/ccheever/projects/snapback-lanebriefs')
PACKET = Path('/Users/ccheever/clique-sb4-20260913-relaxed-3models')
OUT = Path('/Users/ccheever/projects/snapback-relaxed-record/benchmarks/runs/2026-09-14-snapback4-clique-0.2.10')
LITERAL = re.compile(r'''(?im)(\b[\w-]*(?:password|passwd|pwd|token|secret|api_key|apikey|authorization|\bpw\b|\bpass\b)[\w-]*\s*["']?\s*[:=]\s*)(["'])([^"'\r\n]*)(["'])''')

def sha(data):
    return hashlib.sha256(data).hexdigest()

def main(wave):
    lane = PACKET / 'lanes' / f'{wave}-snapback4'
    custody = ROOT / 'cell-custody-0.2.10' / wave
    obs = custody / 'm7-observer'
    final = json.loads((custody / 'm7-final-identities.json').read_text())
    start = json.loads((PACKET / 'logs' / f'{wave}-snapback4.m7.start.json').read_text())
    started = datetime.fromisoformat(start['startedAt'].replace('Z', '+00:00'))
    prefix = Path(wave) / 'm7'
    manifest = OUT / 'custody' / f'{wave}-m7-copy-manifest.json'
    assert not manifest.exists(), 'Preserve completed copy manifest'
    spec = importlib.util.spec_from_file_location('observer', ROOT / 'm7-custody-observer.py')
    observer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(observer)
    copies = []

    def copy(source, rel, redact=False):
        assert source.is_file() and not source.is_symlink(), source
        raw = source.read_bytes()
        assert not observer.TOKEN.search(raw), f'Sensitive token marker: {source}'
        archived, n = raw, 0
        if redact:
            text, n = LITERAL.subn(lambda m: m[1] + m[2] + '[REDACTED_LITERAL]' + m[4], raw.decode())
            archived = text.encode()
        dest = OUT / rel
        if dest.exists():
            assert dest.read_bytes() == archived, f'Existing different bytes: {dest}'
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(archived)
        copies.append({'source': str(source), 'destination': str(rel),
                       'original': {'bytes': len(raw), 'sha256': sha(raw)},
                       'archived': {'bytes': len(archived), 'sha256': sha(archived)},
                       'literalRedactions': n})

    for name in ['run-log.md', 'diary.md', 'essay-paragraphs.md', 'final-report.md']:
        copy(lane / 'm7' / name, prefix / name)
    if (lane / 'm7/FINAL.md').is_file():
        copy(lane / 'm7/FINAL.md', prefix / 'FINAL.md')
    for tag in ['start', 'end']:
        p = PACKET / 'logs' / f'{wave}-snapback4.m7.{tag}.json'
        copy(p, Path('logs') / p.name)
        copy(obs / f'{tag}.json', prefix / 'observer' / f'{tag}.json')
    for name in ['m7-final-identities.json', 'm7-late-process-observation.json', 'immediately-before-m7-source-integrity.json']:
        copy(custody / name, prefix / 'custody' / name)
    copy(obs / 'events.jsonl', prefix / 'observer/events.jsonl')
    for name in ['migration-correction.log', 'migration-recovery.log', 'toolchain-final.txt',
                 'choreography-final.log', 'typecheck-final.txt', 'ios-export-final.log']:
        p = lane / 'm7/evidence' / name
        if p.is_file():
            copy(p, prefix / 'evidence-files/m7/evidence' / name)

    # Full observer inventories remain external. Keep a compact derived history
    # with each original manifest identity, and the actual first/last manifests.
    versions = []
    for p in (obs / 'source-versions').glob('*.json'):
        versions.append((json.loads(p.read_text())['observedAt'], p))
    versions.sort()
    history, previous = [], {}
    for at, p in versions:
        raw = p.read_bytes()
        now = json.loads(raw)['sources']
        delta = {k: v for k, v in now.items() if previous.get(k) != v}
        history.append({'observedAt': at, 'originalManifest': str(p),
                        'originalManifestSha256': sha(raw), 'changes': delta,
                        'removedPaths': sorted(set(previous) - set(now))})
        previous = now
    for label, (_, p) in [('first', versions[0]), ('last', versions[-1])]:
        copy(p, prefix / 'observer' / f'{label}-source-manifest.json')
    history_path = OUT / prefix / 'observer/source-change-history.json'
    history_path.write_text(json.dumps({'method': 'Derived ordered deltas from external observer manifests; hashes and mtime changes are observations, not behavioral qualification.', 'versions': history}, indent=2) + '\n')

    events = [json.loads(x) for x in (obs / 'events.jsonl').read_text().splitlines()]
    retained_objects = set()
    selected_events = []
    for event in events:
        if not event.get('copied'):
            continue
        rel = event['path']
        at = datetime.fromisoformat(event['observedAt'])
        relevant = rel.startswith('m7/') or at >= started
        if (not relevant or '/generated/' in rel or event['bytes'] > 1000000
                or 'provider.jsonl' in rel or 'scale-settle' in rel):
            continue
        source = obs / event['object']
        data = source.read_bytes()
        assert sha(data) == event['sha256'] and len(data) == event['bytes']
        selected_events.append(event)
        if event['object'] not in retained_objects:
            copy(source, prefix / 'observer' / event['object'])
            retained_objects.add(event['object'])
        current = lane / rel
        if current.is_file() and current.read_bytes() == data:
            copy(source, prefix / 'evidence-files' / rel)
    (OUT / prefix / 'observer/selected-events.json').write_text(json.dumps(selected_events, indent=2) + '\n')

    # Keep Quarry and app implementation, including pre/initial/served schema
    # variants. Script bodies remain hash-only: they may embed fixture credentials.
    selected_sources = []
    for name, expected in sorted(final['sourceHashes'].items()):
        p = Path(name)
        include = p.suffix == '.q' or (p.parts[0] in {'app', 'src', 'lib'} and p.suffix in {'.ts', '.tsx', '.js'})
        if not include or 'generated' in p.parts:
            continue
        source = lane / p
        assert sha(source.read_bytes()) == expected['sha256'], f'Changed after final identity capture: {name}'
        copy(source, prefix / 'source' / p, redact=True)
        selected_sources.append(name)
    for name in ['API.md', 'README.md']:
        if (lane / name).is_file():
            copy(lane / name, prefix / 'source' / name, redact=True)
    receipt = {'observedAt': datetime.now(timezone.utc).isoformat(), 'lane': wave,
               'files': copies, 'derivedFiles': [str(history_path.relative_to(OUT)), str(prefix / 'observer/selected-events.json')],
               'selectedSourcePaths': selected_sources, 'selectedObjectCount': len(retained_objects),
               'capturingToolSha256': sha(Path(__file__).read_bytes()),
               'limits': 'Selective archive of received M7 artifacts, not a grade or runnable clone. All observer events are inventoried, '
                         'but only safe evidence under m7 or observed after phase start is copied, excluding generated residency, provider logs and objects over 1 MB. '
                         'Earlier inherited scale receipts remain outside this M7 copy. Intermediate original source manifests remain external; '
                         'a derived change history and the first/last original manifests are local. Script bodies remain hash-only; '
                         'selected application sources use explicit conservative literal redactions with separate original/archive hashes. '
                         'The two-second observer can miss writes. Raw model streams, stores, credentials and most generated artifacts are omitted.'}
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'manifest': str(manifest), 'copies': len(copies), 'objects': len(retained_objects),
                      'archiveBytes': sum(x['archived']['bytes'] for x in copies),
                      'redactedSources': [x['destination'] for x in copies if x['literalRedactions']]}, indent=2))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('wave', choices=['astra', 'grok', 'muse'])
    main(parser.parse_args().wave)
