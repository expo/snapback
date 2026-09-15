#!/usr/bin/env python3
"""Check final record tables against received artifacts; never rescore a lane."""
import hashlib
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

REPO = Path('/Users/ccheever/projects/snapback-relaxed-record')
ROOT = Path('/Users/ccheever/projects/snapback-lanebriefs')
ARCHIVE = REPO / 'benchmarks/runs/2026-09-14-snapback4-clique-0.2.10'


def identity(path):
    data = path.read_bytes()
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def json_document(path):
    text = path.read_text()
    if path.suffix == '.json':
        return json.loads(text)
    fences = re.findall(r'```json\s*\n(.*?)\n```', text, re.S)
    assert len(fences) == 1, str(path)
    return json.loads(fences[0])


def row(text, label):
    rows = [line for line in text.splitlines() if line.startswith('| ' + label + ' |')]
    assert len(rows) == 1, (label, len(rows))
    return [x.strip() for x in rows[0].split('|')[1:-1]]


def tally(report):
    result = Counter(v['result'] for v in report['assertionResults'].values())
    return {k: result[k] for k in ['pass', 'fail', 'not-run', 'not-applicable']}


def main():
    notes = (ARCHIVE / 'MEASUREMENT-NOTES.md').read_text()
    readme = (ARCHIVE / 'README.md').read_text()
    comparison = json.loads((ARCHIVE / 'comparison.json').read_text())
    sources = []
    for index, case in enumerate(comparison['cases']):
        pin, family = case['pin'], case['modelFamily']
        docs = []
        for source in case['sources']:
            path = REPO / source['path']
            assert identity(path)['sha256'] == source['sha256'], str(path)
            docs.append(json_document(path))
            sources.append(source)
        score, main_report, m8 = docs
        if 'scores' in score:
            score = score['scores'][family]
        received = {k: v['score'] for k, v in score['backends']['snapback4'].items()}
        assert received == case['holistic'], (pin, family, 'holistic source')
        for key, value in received.items():
            assert int(row(notes, key)[index + 1]) == value, (pin, family, key)
        prior, extra = tally(main_report), tally(m8)
        combined = {k: prior[k] + extra[k] for k in prior}
        assert case['grade'] == {'prior101': prior, 'm8Only18': extra, 'complete119': combined}
        assert sum(prior.values()) == 101 and sum(extra.values()) == 18
        label = pin + ' ' + family.capitalize()
        grade_row = row(notes, label)
        assert grade_row[1] == ' / '.join(map(str, prior.values())), label
        assert grade_row[2] == ' / '.join(map(str, extra.values())), label
        for offset, key in enumerate(['O1', 'O2', 'O3', 'O4', 'O5']):
            value = main_report['oDimensionScores'][key]
            compact = None if value is None else ({'band': value['band']} if key == 'O5' else {'score': value['score']})
            assert compact == case['oDimensions'][key], (label, key)
            expected = 'null' if compact is None else ('band ' + str(compact['band']) if key == 'O5' else str(compact['score']))
            if pin == '0.2.10' and family == 'astra' and key == 'O3':
                expected += ' provisional'
            assert grade_row[offset + 3] == expected, (label, key)
        main_row = row(readme, label)
        assert int(main_row[3]) == received['overall']
        assert main_row[4] == ' / '.join(map(str, combined.values()))

    phases = []
    bases = {'0.2.6': REPO / 'benchmarks/runs/2026-09-13-snapback4-clique-0004',
             '0.2.9': REPO / 'benchmarks/runs/2026-09-14-snapback4-clique-astra-0.2.9',
             '0.2.10': ARCHIVE}
    for case in comparison['cases']:
        pin, family = case['pin'], case['modelFamily']
        base = bases[pin]
        candidates = [base / 'logs' / f'{family}-snapback4.end.json', base / family / 'builder.end.json', base / family / 'runner-end.json']
        # Historical archives may retain lifecycle under another subdirectory.
        candidates += list(base.rglob(f'{family}-snapback4.end.json'))
        candidates = list(dict.fromkeys(p for p in candidates if p.is_file()))
        assert candidates, (pin, family, 'builder end absent')
        versions = [json.loads(p.read_text()) for p in candidates]
        end = versions[0]
        assert all(v == end for v in versions), (pin, family, 'ambiguous end')
        cells = row(readme, pin + ' ' + family.capitalize())
        assert float(cells[1].replace(',', '')) == end['wallSeconds']
        assert int(cells[2]) == end['exitCode']
        phases.append({'pin': pin, 'family': family, 'phase': 'builder',
                       'source': str(candidates[0].relative_to(REPO)), **identity(candidates[0]),
                       'wallSeconds': end['wallSeconds'], 'actualExit': end['exitCode']})
    for family in ['astra', 'grok', 'muse']:
        path = ARCHIVE / 'logs' / f'{family}-snapback4.m7.end.json'
        end = json.loads(path.read_text())
        cells = row(readme, family.capitalize())
        assert float(cells[1].replace(',', '')) == end['wallSeconds']
        assert int(cells[2]) == end['exitCode']
        phases.append({'pin': '0.2.10', 'family': family, 'phase': 'm7',
                       'source': str(path.relative_to(REPO)), **identity(path),
                       'wallSeconds': end['wallSeconds'], 'actualExit': end['exitCode']})
    result = {'observedAt': datetime.now(timezone.utc).isoformat(),
              'checks': {'holisticCells': 91, 'gradePartitionRows': 7, 'oDimensionCells': 35,
                         'mainTableRows': 7, 'currentM7Rows': 3, 'allMatch': True},
              'documents': {name: identity(ARCHIVE / name) for name in ['README.md', 'MEASUREMENT-NOTES.md', 'comparison.json']},
              'sources': sources, 'execution': phases, 'tool': identity(Path(__file__)),
              'limits': 'Checks stated table numbers against received artifacts. Does not certify narrative interpretation, grade semantics, equivalent coverage, calibration or causality. Earlier comparison.json draftVerification retains its historical draft hash; this receipt binds final document bytes.'}
    out = ROOT / ('cell-final-comparison-verification-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '.json')
    with out.open('x') as f:
        json.dump(result, f, indent=2)
        f.write('\n')
    print(json.dumps({'receipt': str(out), **result['checks']}, indent=2))


if __name__ == '__main__':
    main()
