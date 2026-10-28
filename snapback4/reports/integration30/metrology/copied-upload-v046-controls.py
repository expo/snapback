"""Acceptance-hole controls for the fixed copied-upload witness extension."""
from pathlib import Path
import collections
import copy
import hashlib
import importlib.util
import json

root = Path(__file__).parent
spec = importlib.util.spec_from_file_location('copied_v046', root / 'copied-upload-v046-audit.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
original_path = root / 'identity-tools/copied-upload-audit.py'
expected_original_hash = json.loads((root / 'identity-tools/provenance.json').read_text())['sha256']['copied-upload-audit.py']
assert hashlib.sha256(original_path.read_bytes()).hexdigest() == expected_original_hash
capture = root / 'identity/w23-008-snapback-arborist-removal-quotes.json'
item = json.loads(capture.read_text())
pairs = collections.defaultdict(dict)
for row in item['rows']:
    pairs[row['mode'], row['temperature']][row['label']] = row['security']
accepted = []
for key, pair in pairs.items():
    a, b = pair['baseline'], pair['candidate']
    if audit.canonical(a) == audit.canonical(b):
        continue
    result = audit.audit_envelope(a, b)
    assert result['accepted'], (key, result)
    accepted.append(key)
assert len(accepted) == 5
left, right = (pairs['check', 'cold'][label] for label in ['baseline', 'candidate'])
index = next(i for i, row in enumerate(left['reviews']) if row['id'] == audit.CHILD_DECISION)


def witness(value):
    return value['reviews'][index]['witness']


controls = []


def reject(name, mutation):
    a, b = copy.deepcopy(left), copy.deepcopy(right)
    mutation(a, b)
    try:
        result = audit.audit_envelope(a, b)
        rejected = not result['accepted']
    except (AssertionError, KeyError, TypeError, ValueError):
        rejected = True
    assert rejected, name
    controls.append(name)


reject('different question family', lambda a, b: [x['reviews'][index].update(code='N_OTHER') for x in [a, b]])
reject('different fixed witness ID', lambda a, b: [witness(x).update(id='a' * 64) for x in [a, b]])
reject('changed decision ID', lambda a, b: b['reviews'][index].update(id='b' * 64))
reject('changed gate tier', lambda a, b: b['reviews'][index].update(gated=True))
reject('changed caller', lambda a, b: witness(b).update(viewer='another-caller'))
reject('changed ordinary row ID', lambda a, b: witness(b)['row'].update(id='ordinary-row'))
reject('changed history caller', lambda a, b: witness(b)['history'][0].update(viewer='another-caller'))
reject('supporting row order', lambda a, b: witness(b)['supportingRows']['siteSurveys'].reverse())
reject('logical upload timestamp', lambda a, b: witness(b)['supportingRows']['siteSurveys'][0].update(treePhoto='02' + witness(b)['supportingRows']['siteSurveys'][0]['treePhoto'][2:]))
reject('upload alias merger', lambda a, b: witness(b)['supportingRows']['siteSurveys'][0].update(linesPhoto=witness(b)['supportingRows']['siteSurveys'][0]['treePhoto']))
reject('unsorted generated ID set rendering', lambda a, b: witness(b)['generatedIds'].reverse())
reject('lost generated identity', lambda a, b: witness(b)['generatedIds'].pop())
reject('opaque alias recoloring', lambda a, b: [witness(x).update(opaqueAlias=witness(x)['supportingRows']['siteSurveys'][0]['treePhoto']) for x in [a, b]])
reject('summary outside old fixed property tokens', lambda a, b: witness(b).update(summary=witness(b)['summary'] + witness(b)['supportingRows']['siteSurveys'][0]['treePhoto']))
reject('unrelated report verdict', lambda a, b: b['report']['invariants'][0].update(status='unproved' if a['report']['invariants'][0]['status'] != 'unproved' else 'proved'))
reject('scalar boolean versus integer', lambda a, b: witness(b)['row'].update(hazardous=0))

result = dict(actualNoncePairsAccepted=len(accepted), negativeControlsRejected=len(controls),
              controls=controls, sourceSha256=item['rows'][0]['sourceSha256'],
              captureSha256=hashlib.sha256(capture.read_bytes()).hexdigest(),
              adapterSha256=hashlib.sha256((root / 'copied-upload-v046-audit.py').read_bytes()).hexdigest(),
              originalCheckerUnchanged=hashlib.sha256(original_path.read_bytes()).hexdigest() == expected_original_hash,
              originalCheckerSha256=expected_original_hash,
              completeCensusQualified=False,
              unchangedControlSelfReproduction='still mandatory after full census')
assert result['originalCheckerUnchanged']
(root / 'copied-upload-v046-controls.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
