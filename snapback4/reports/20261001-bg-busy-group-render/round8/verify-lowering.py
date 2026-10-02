"""Reverse only the new point-read slot split; require every historical digest."""
from pathlib import Path
import json, hashlib, re
root = Path(__file__).resolve().parents[3]
evidence = Path(__file__).resolve().parent
fixtures = root / 'crates/snapback4-lang/tests/lowering'
golden = {}
for file in ['ce15819ad.sha256', 'intent-shape-overrides.sha256', 'first-paste-admissions.sha256']:
    golden.update(line.split('\t') for line in (fixtures / file).read_text().splitlines())
changes = []
checked = 0
for name, record in map(json.loads, (evidence / 'lowering-current.jsonl').read_text().splitlines()):
    original = record['ir']
    program = json.loads(original)
    eliminated = []
    replacements = {}
    def reverse(value):
        if isinstance(value, list):
            for i, stmt in enumerate(value[:-1]):
                if not isinstance(stmt, dict) or set(stmt) != {'Let'}: continue
                binding = stmt['Let']['name']
                match = re.fullmatch(r'\$countRow(\d+)', binding)
                if not match: continue
                number = int(match[1]); result = f'$total{number + 1}'
                branch = value[i + 1]['If']
                assert branch == {
                    'condition': {'Binary': {'op':'Eq', 'left':{'Variable':binding}, 'right':{'Literal':'Null'}}},
                    'then_body': [{'Let': {'name':result, 'value':{'Literal':{'Int':0}}}}],
                    'else_body': [{'Let': {'name':result, 'value':{'Field':{'base':{'Variable':binding}, 'name':'value'}}}}],
                }, (name, branch)
                for arm in ['then_body', 'else_body']:
                    branch[arm][0] = {'Assign':branch[arm][0]['Let']}
                eliminated.append(number + 1)
                replacements[binding] = f'$total{number}'
            for item in value: reverse(item)
        elif isinstance(value, dict):
            for item in value.values(): reverse(item)
    reverse(program)
    def rename(value):
        if isinstance(value, str):
            value = replacements.get(value, value)
            match = re.fullmatch(r'(\$.*?)(\d+)', value)
            if match:
                number = int(match[2])
                shift = sum(n <= number for n in eliminated)
                if shift: return match[1] + str(number - shift)
        elif isinstance(value, list): return [rename(item) for item in value]
        elif isinstance(value, dict): return {key:rename(item) for key,item in value.items()}
        return value
    restored = json.dumps(rename(program), ensure_ascii=False, separators=(',', ':'))
    digest = lambda s: hashlib.sha256(s.encode()).hexdigest()
    assert digest(restored) == golden[name], name
    checked += 1
    if digest(original) != golden[name]:
        assert eliminated
        changes.append({'program':name, 'point_reads':len(eliminated), 'historical':golden[name], 'current':digest(original)})
assert checked == len(golden) == 3228
assert len(changes) == 96
(evidence / 'lowering-delta.json').write_text(json.dumps({'checked_programs':checked,'changed_programs':len(changes),
    'point_reads':sum(p['point_reads'] for p in changes), 'all_historical_digests_restored':True, 'changes':changes},indent=2)+'\n')
print(f'{checked} historical digests restored; {len(changes)} programs differ only by the point-read slot split and its temporary renumbering')
