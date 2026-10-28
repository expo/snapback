"""Source-bound extension of the existing upload-ID ticket to one fixed witness.

The original N_ARGUMENT_GRANT checker remains unchanged. SEC11b also exposes
the same six copied image IDs in the supporting initial rows of a fixed
N_CHILD_EVIDENCE_PRESENCE witness. No other ID or payload path is accepted.
"""
import copy
import hashlib
import importlib.util
import json
import pathlib
import re

BASE = pathlib.Path(__file__).parent
TOOLS = BASE / 'identity-tools'
spec = importlib.util.spec_from_file_location('original_copied_upload', TOOLS / 'copied-upload-audit.py')
original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)
KEY = original.KEY
WITNESS = original.WITNESS
FIELDS = original.FIELDS
get = original.get
canonical = original.canonical
CHILD_WITNESS = '6d0fc50b02b03f14d78eebd7fa8dccace04f176ab870f42ddf7110f5b8482c99'
CHILD_DECISION = '229aa2ac3acc7f97e512a2e6835e624e996177d7cb57aea51c57b2373cd695ce'
CHILD_CANDIDATE = 'invariant trees.createTree only (count(quotes[tree = .id]) > 0)'


def source_guard():
    origin = json.loads((TOOLS / 'reviewed-copied-upload-origin.json').read_text())[KEY]
    app = pathlib.Path.home() / 'sb4-loop/wave23/apps/008-snapback-arborist-removal-quotes/snapback'
    texts = [(q.name, q.read_text()) for q in sorted(app.glob('*.q'))]
    digest = hashlib.sha256(canonical(dict(current=texts, predecessor=[])).encode()).hexdigest()
    assert digest == origin['sourceSha256']
    text = '\n'.join(value for _, value in texts)
    for token in origin['requiredSourceText']:
        assert token in text
    assert "mutation createTree(homeowner: principal, label: text 1..100, address: text 5..250, hazardous: bool, permitRequired: bool):" in text
    assert 'return insert trees { homeowner, label, address, hazardous, permitRequired }' in text


def nonce_pair(left, right):
    return (type(left) is str and type(right) is str
            and re.fullmatch('[0-7][0123456789ABCDEFGHJKMNPQRSTVWXYZ]{25}', left)
            and re.fullmatch('[0-7][0123456789ABCDEFGHJKMNPQRSTVWXYZ]{25}', right)
            and left[:10] == right[:10])


def audit_child(left, right):
    try:
        assert left['id'] == right['id'] == CHILD_WITNESS
        assert left['candidate'] == right['candidate'] == CHILD_CANDIDATE
        assert left['operation'] == right['operation'] == 'createTree'
        assert left['reachability'] == right['reachability'] == 'generated-fixture-trace'
        assert left['viewer'] == right['viewer'] == 'account:security-roles-owner-0'
        assert left['effect'] == right['effect'] == 'insert'
        assert left['old'] is None and right['old'] is None
        rows_a = left['supportingRows']['siteSurveys']
        rows_b = right['supportingRows']['siteSurveys']
        assert len(rows_a) == len(rows_b) == 2
        mapping, reverse, paths = {}, {}, set()
        for index, (a, b) in enumerate(zip(rows_a, rows_b)):
            assert a['id'] == b['id'] and a['initial'] is True and b['initial'] is True
            assert a['initialKey'] == a['quote'] == b['initialKey'] == b['quote']
            for field in FIELDS:
                assert a[field.replace('Photo', 'Legacy')] is True
                assert b[field.replace('Photo', 'Legacy')] is True
                x, y = a[field], b[field]
                assert nonce_pair(x, y) and x not in mapping and y not in reverse
                mapping[x], reverse[y] = y, x
                paths.add(('supportingRows', 'siteSurveys', index, field))
        assert len(mapping) == len(reverse) == 6
        assert not ({x for x, y in mapping.items() if x != y} & set(reverse))
        assert not ({y for x, y in mapping.items() if x != y} & set(mapping))
        expected = copy.deepcopy(left)
        for path in paths:
            container = get(expected, path[:-1])
            container[path[-1]] = mapping[container[path[-1]]]
        ids_a, ids_b = left['generatedIds'], right['generatedIds']
        assert type(ids_a) is list and type(ids_b) is list
        assert all(type(value) is str for value in ids_a + ids_b)
        assert ids_a == sorted(set(ids_a)) and ids_b == sorted(set(ids_b))
        assert set(mapping) <= set(ids_a) and set(reverse) <= set(ids_b)
        expected['generatedIds'] = sorted(mapping.get(value, value) for value in ids_a)
        for path, value in original.leaves(left):
            if type(value) is str and (value in mapping or value in reverse):
                assert path in paths or path[:1] == ('generatedIds',)
        assert canonical(expected) == canonical(right)
        return dict(accepted=True, witnessId=CHILD_WITNESS, idPairs=6,
                    origin='two initial siteSurveys rows copied from openQuote image arguments')
    except (AssertionError, KeyError, TypeError, ValueError) as error:
        return dict(accepted=False, reason=type(error).__name__ + ': ' + str(error))


def audit_envelope(left, right):
    source_guard()
    expected, results = copy.deepcopy(left), []
    for prefix in [('reviews',), ('security', 'securityReviews')]:
        try:
            rows_a, rows_b = get(left, prefix), get(right, prefix)
        except (KeyError, TypeError):
            continue
        assert type(rows_a) is list and type(rows_b) is list and len(rows_a) == len(rows_b)
        for index, (a, b) in enumerate(zip(rows_a, rows_b)):
            if canonical(a) == canonical(b):
                continue
            metadata = copy.deepcopy(a)
            metadata['witness'] = b.get('witness')
            if canonical(metadata) != canonical(b):
                return dict(accepted=False, reason='question metadata differs')
            if a.get('code') == b.get('code') == 'N_ARGUMENT_GRANT':
                result = original.audit_witness(a['witness'], b['witness'])
                if result['accepted']:
                    for x, y in zip(a['witness']['supportingRows']['siteSurveys'], b['witness']['supportingRows']['siteSurveys']):
                        if not all(nonce_pair(x[field], y[field]) for field in FIELDS):
                            return dict(accepted=False, reason='malformed upload ULID or changed logical timestamp')
            elif (a.get('code') == b.get('code') == 'N_CHILD_EVIDENCE_PRESENCE'
                  and a.get('id') == b.get('id') == CHILD_DECISION
                  and a.get('site') == b.get('site') == 'schema.q:38:10'
                  and a.get('gated') is False and b.get('gated') is False):
                result = audit_child(a['witness'], b['witness'])
            else:
                return dict(accepted=False, reason='outside the two fixed source-bound copied-upload witnesses')
            results.append(result)
            if not result['accepted']:
                return result
            get(expected, prefix)[index] = copy.deepcopy(b)
    return dict(accepted=bool(results) and canonical(expected) == canonical(right), witnesses=results)
