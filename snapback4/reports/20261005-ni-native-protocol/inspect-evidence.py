#!/usr/bin/env python3
"""Summarize the raw observations supporting NI's specific controls."""
import json
from pathlib import Path
import sys

here = Path(__file__).resolve().parent
sys.path.insert(0, str(here.parents[2] / 'benchmarks/native/0.4.0-native.1/driver'))
from evidence import nodes, row

root = here / 'evidence/mini'
names = [Path(line).name for line in (root / 'qualification-closeout.stdout').read_text().splitlines()
         if line.startswith('/private/tmp/') and '/runs/' in line]
results = []
for name in names:
    run = root / 'runs' / name
    operator = json.loads((run / 'operator.json').read_text())
    out = run / 'evidence'
    read = lambda n: json.loads((out / n).read_text())
    fixture = read('native-fixture.json')
    events = [json.loads(line) for line in (out / 'native-observations.jsonl').read_text().splitlines()]
    value = {'run': name, 'control': operator['control'], 'segment': operator['segment'],
             'status': read('status.json')}
    control = operator['control']
    if control == 'none':
        receipts = [json.loads(line) for line in (out / (operator['segment'] + '-ios-receipts.jsonl')).read_text().splitlines()]
        value['assertions'] = {r['assertion']: r['pass'] for r in receipts}
    else:
        value['failureTreeCaptured'] = (out / 'failure.json').exists()
        value['failureScreenshotCaptured'] = (out / 'failure.png').exists()
        value['xctestCompletedNormally'] = 'TEST EXECUTE SUCCEEDED' in (out / 'xctest.log').read_text()
    if control == 'placeholder':
        value['falseLoadEvents'] = [e for e in events if e['kind'] == 'media' and e['payload']['messageId'] == fixture['ordinary']['messageId'] and e['payload']['event'] == 'load']
        value['pixels'] = read('cold-ordinary-pixels.json')
    elif control == 'volatile-outbox':
        pending = read('warm-pending-2.json')
        ids = [n['value'] for n in nodes(pending, 'sm-convo-bubble') if any(c.get('label') in fixture['queuedBodies'] for c in nodes(n))]
        failure = read('failure.json')
        value.update(pendingIds=ids, matchingRowsAfterTermination=[n['value'] for n in nodes(failure, 'sm-convo-bubble') if n['value'] in ids])
    elif control in ['duplicate-sends', 'reversed-sends']:
        oracle = read('server-flush.json')
        value['rawOracleRows'] = [r for r in oracle['rows'] if r['body'] in fixture['queuedBodies']]
    elif control == 'stale-viewonce':
        value['deniedEvents'] = [e for e in events if e['kind'] == 'media' and e['payload']['messageId'] == fixture['viewOnce']['messageId'] and e['payload']['event'] == 'denied']
        value['staleImageNodes'] = nodes(read('cold-once.json'), 'sm-media-viewer-image')
    elif control == 'collapsed-receipt':
        tree = read('pending-1.json')
        bubbles = [n for n in nodes(tree, 'sm-convo-bubble') if any(c.get('label') == fixture['queuedBodies'][0] for c in nodes(n))]
        value['identifiedBodies'] = [{'id': b['value'], 'receiptNodes': nodes(b, 'sm-convo-receipt')} for b in bubbles]
        assert len(bubbles) == 1 and not nodes(bubbles[0], 'sm-convo-receipt')
    elif control == 'wrong-fixture':
        tree = read('failure.json')
        value['declaredHistoryId'] = fixture['history']['messageId']
        value['actualHistoryRows'] = [n['value'] for n in nodes(tree, 'sm-convo-bubble') if any(c.get('label') == fixture['history']['body'] for c in nodes(n))]
        value['prime'] = read('m6-ios-run.json')['prime']
    elif control == 'bob-wrong-conversation':
        value['expectedConversation'] = fixture['conversationId']
        value['bob'] = read('bob.json')
    results.append(value)
(here / 'evidence/control-observations.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps({'runs': len(results), 'controlObservationsWritten': True}))
