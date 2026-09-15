#!/usr/bin/env python3
"""Verify completed phase/file custody, without running apps or rewriting evidence."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/Users/ccheever/projects/snapback-lanebriefs')
PACKET = Path('/Users/ccheever/clique-sb4-20260913-relaxed-3models')
ARCHIVE = Path('/Users/ccheever/projects/snapback-relaxed-record/benchmarks/runs/2026-09-14-snapback4-clique-0.2.10')

def digest(p):
    raw = p.read_bytes()
    return {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}

def main():
    result = {'observedAt': datetime.now(timezone.utc).isoformat(), 'checks': {}}
    expected = dict((name, sha) for sha, name in (x.split('  ', 1) for x in (PACKET / 'INSTRUMENT.sha256').read_text().splitlines()))
    actual = {str(p.relative_to(PACKET)): digest(p)['sha256'] for p in (PACKET / 'instrument').rglob('*') if p.is_file()}
    assert actual == expected, 'Frozen instrument content mismatch'
    writable = [str(p.relative_to(PACKET)) for p in (PACKET / 'instrument').rglob('*') if p.stat().st_mode & 0o222]
    assert not writable, 'Writable frozen instrument entries'
    templates = {}
    for line in (PACKET / 'PROMPT_TEMPLATES.sha256').read_text().splitlines():
        sha, name = line.split('  ', 1)
        assert digest(PACKET / name)['sha256'] == sha, f'Frozen template mismatch: {name}'
        templates[name] = sha
    result['checks']['instrument'] = {'files': len(actual), 'bytes': sum((PACKET / p).stat().st_size for p in actual), 'matchesFrozenManifest': True, 'noWritableEntries': True}
    result['checks']['templates'] = templates
    assert json.loads((PACKET / 'PACKAGE_PINS.json').read_text()) == {'snapback4': '0.2.10', 'snapback4-expo': '0.2.3', 'frozen': True}
    result['checks']['pins'] = digest(PACKET / 'PACKAGE_PINS.json')
    phases, prompts = [], {}
    for wave in ['astra', 'grok', 'muse']:
        for phase in ['builder', 'score', 'grade', 'm7']:
            tag = '' if phase == 'builder' else '.' + phase
            name = f'{wave}-snapback4{tag}'
            start = json.loads((PACKET / 'logs' / f'{name}.start.json').read_text())
            end = json.loads((PACKET / 'logs' / f'{name}.end.json').read_text())
            assert start['pid'] == end['pid'] and start['phase'] == end['phase'] == phase
            assert start['lane'] == end['lane'] == f'{wave}-snapback4'
            assert start['packages'] == {'snapback4': '0.2.10', 'snapback4-expo': '0.2.3'}
            for suffix in ['start', 'end']:
                n = f'{name}.{suffix}.json'
                assert (PACKET / 'logs' / n).read_bytes() == (ARCHIVE / 'logs' / n).read_bytes(), f'Lifecycle copy differs: {n}'
            prompt = PACKET / 'prompts' / f'{name}.md'
            text = prompt.read_text()
            assert 'snapback4@0.2.10' in text and 'snapback4-expo@0.2.3' in text
            prompts[str(prompt.relative_to(PACKET))] = digest(prompt)
            phases.append({'lane': wave, 'phase': phase, 'actualExit': end['exitCode'], 'wallSeconds': end['wallSeconds'],
                           'start': digest(PACKET / 'logs' / f'{name}.start.json'), 'end': digest(PACKET / 'logs' / f'{name}.end.json'),
                           'rawStreamsHashOnly': {key: {'path': end[key], **digest(Path(end[key]))} for key in ['stdout', 'stderr']}})
        for name in ['grader-report.json', 'm8-assertion-results.json', 'trace.md', 'DONE']:
            assert (PACKET / 'lanes' / f'{wave}-snapback4' / 'grading' / name).read_bytes() == (ARCHIVE / wave / 'grading' / name).read_bytes(), f'Grade copy mismatch: {wave}/{name}'
    result['checks']['phases'] = phases
    result['checks']['renderedPromptsAtObservation'] = prompts
    matches = []
    for p in sorted((ARCHIVE / 'custody').glob('*copy-manifest.json')):
        for entry in json.loads(p.read_text())['files']:
            expected = entry.get('archived', {'bytes': entry.get('bytes'), 'sha256': entry.get('sha256')})
            dest = ARCHIVE / entry['destination']
            assert dest.resolve().is_relative_to(ARCHIVE.resolve()) and dest.is_file() and not dest.is_symlink(), str(dest)
            assert digest(dest) == expected, f'Copy manifest mismatch: {dest}'
            matches.append({'manifest': str(p.relative_to(ARCHIVE)), 'destination': entry['destination']})
    result['checks']['copyManifests'] = {'entriesChecked': len(matches), 'uniqueDestinations': len({x['destination'] for x in matches}), 'allMatch': True}
    result['capturingToolSha256'] = digest(Path(__file__))['sha256']
    result['limits'] = ('Read-only completed-file observation. Lifecycle exits remain actual, including nonzero outcomes; file presence does not mean green. '
                        'Prompt pins and final hashes are checked, not continuous rendered-prompt identity. Frozen instrument/template manifests are compared in full. '
                        'Copy manifests identify actual selected archive destinations, including explicitly redacted source. '
                        'This does not rerun apps, grade semantics, certify complete process teardown, scan credentials or replace the scoped ref-check.')
    out = ROOT / ('completed-cell-record-verification-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '.json')
    with out.open('x') as f:
        json.dump(result, f, indent=2)
        f.write('\n')
    print(json.dumps({'receipt': str(out), 'instrumentFiles': len(actual), 'phases': len(phases), 'copyEntries': len(matches)}, indent=2))

if __name__ == '__main__':
    main()
