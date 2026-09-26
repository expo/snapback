#!/usr/bin/env python3
"""Audit frozen records, align AST units, and emit a reviewable comparison.

Run with snapback5/.venv/bin/python (pglast 7.10). Does not execute either
classifier or modify its evidence. See README for scope and resolutions.
"""
# @ref LLP 4001#7-pre-tests-compiler-free-before-any-lane — preserve independent classifications, reconcile AST units and apply recorded resolutions
import argparse
import ast
from collections import Counter, defaultdict
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
RANK = {c: n for n, c in enumerate(['ignored', 'admitted', 'canonicalized', 'rewritten', 'refused'])}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_units(family):
    units = [json.loads(s) for s in (HERE/family/'units.jsonl').read_text().splitlines()]
    assert len(units) == len({u['id'] for u in units})
    return units


def normalize(value):
    if isinstance(value, dict):
        return {k: normalize(v) for k, v in value.items()
                if k not in ('location', 'stmt_location', 'stmt_len', 'lineno')}
    if isinstance(value, list):
        return [normalize(x) for x in value]
    if isinstance(value, str):
        return re.sub(r'(?<![A-Za-z0-9_])(?:clqfm_|ns_)', '{{P}}', value)
    return value


def fingerprint(kind, value):
    return json.dumps([kind, normalize(value)], sort_keys=True)


def md(value):
    return str(value).replace('|', '\\|').replace('\n', '<br>')


def resolved_ledgers(builder, blind, pairs, bmeta, gmeta):
    maps = {'builder': {u['id']: dict(u, raw=bool(u['raw_refused']), group=bmeta[u['id']]['group']) for u in builder},
            'blind': {u['id']: dict(u, raw=u['class'] in ('rewritten','refused'), group=gmeta[u['id']]['group']) for u in blind}}
    changes = []
    def change(family, uid, cls, raw, rule):
        u = maps[family][uid]
        if (u['class'],u['raw']) != (cls,raw):
            changes.append(dict(family=family,id=uid,group=u['group'],rule=rule,
                                before=u['class'],after=cls,raw_before=u['raw'],raw_after=raw))
            u.update({'class':cls,'raw':raw})
    for p in pairs:
        bid, gid = p['builder_ids'][0], p['blind_id']
        b, g = maps['builder'][bid], maps['blind'][gid]
        a = set(p['builder_ambiguity'])
        ga = p['blind_ambiguity'] or ''
        # Apply the pre-total rules to source-identified ambiguity units only.
        if p['tier'] != 'top':
            if 'A-KEYS' in a:
                change('blind',gid,p['builder_class'],True,'A-KEYS / B01')
            if 'A-UUID' in a and p['builder_class'] == 'rewritten':
                change('blind',gid,'rewritten',True,'A-UUID / B02')
            if 'A-PROBE-CLASS' in a and p['builder_class'] == 'rewritten':
                change('blind',gid,'rewritten',b['raw'],'A-PROBE-CLASS / B14 / B16')
            if a & {'A-IN-LIST','A-NULL','A-NULL-OR','A-REWRITE-SET','A-BODY-CONTEXT'}:
                rule = ' / '.join(sorted(a & {'A-IN-LIST','A-NULL','A-NULL-OR','A-REWRITE-SET','A-BODY-CONTEXT'}))
                change('blind',gid,p['builder_class'],b['raw'],rule)
            if 'Ordered comparisons and boolean tests on parameters and locals' in ga:
                change('blind',gid,p['builder_class'],b['raw'],'B06 / A-BODY-CONTEXT')
            if 'Executable statement is in a trigger function' in p['blind_reading']:
                change('blind',gid,p['builder_class'],b['raw'],'A-BODY-CONTEXT (no signature taint)')
            if 'A for-loop select that is not a point read' in ga:
                change('blind',gid,p['builder_class'],b['raw'],'B21 / A-BODY-CONTEXT')
            if 'A no-action REFERENCES' in ga:
                change('builder',bid,'refused',True,'B04 (reference type required)')
            if 'ALTER … DROP CONSTRAINT IF EXISTS' in ga:
                change('blind',gid,p['builder_class'],b['raw'],'B17 (§7 final-catalog enum replacement)')
            if 'create or replace is a registered creation alias' in ga:
                change('builder',bid,'canonicalized',False,'B22 (creation alias)')
        if p['tier'] == 'top':
            if 'A-EXTENSION' in a:
                change('blind',gid,'ignored',False,'A-EXTENSION / B25')
            if a & {'A-EXPIRY','A-NESTED-PROBE'}:
                change('blind',gid,p['builder_class'],b['raw'],' / '.join(sorted(a & {'A-EXPIRY','A-NESTED-PROBE'})))
            if 'A-PROBE-CLASS' in a:
                change('blind',gid,p['builder_class'],b['raw'],'A-PROBE-CLASS / B14 / B16')
    # Only changed-child parents need propagation. Preserve each family's base
    # creation-alias placement, and any independent structural refusal.
    for family, metas in [('builder',bmeta),('blind',gmeta)]:
        affected = {x['id'].rsplit(':',1)[0] for x in changes if x['family']==family and x['group']!='top'}
        for pid in sorted(affected):
            parent = maps[family][pid]
            children = [u for uid,u in maps[family].items() if uid.rsplit(':',1)[0]==pid]
            ast_obj = metas[pid]['ast']
            alias = ast_obj.get('if_not_exists') or ast_obj.get('replace') or any(
                c['AlterTableCmd'].get('missing_ok') for c in ast_obj.get('cmds',[]))
            base = 'canonicalized' if alias else 'admitted'
            cls = max([base]+[u['class'] for u in children],key=RANK.get)
            change(family,pid,cls,any(u['raw'] for u in children),'§7 worst-child propagation')
    return maps, changes


def bucket(units):
    return dict(n=len(units),raw=sum(u['raw'] for u in units),post=sum(u['class']=='refused' for u in units),
                classes=dict(Counter(u['class'] for u in units)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', type=Path, default=Path('/Users/ccheever/projects/snapback-sb5-program/pretest1'))
    ap.add_argument('--out', type=Path, default=ROOT/'snapback5/.work/pretest1-record')
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    freeze = json.loads((HERE/'freeze.json').read_text())
    bh = json.loads((HERE/'builder/freeze-hashes.json').read_text())
    gh = json.loads((HERE/'blind/verified-hashes.json').read_text())
    assert sha((HERE/'freeze.json').read_bytes()) == bh['freeze_sha256']
    hashes = []
    for item in [freeze['rubric']] + freeze['manifest']:
        p = item['path']
        b = next(x for x in bh['files'] if x['path'] == p)
        g = gh['rubric'] if item is freeze['rubric'] else next(x for x in gh['files'] if x['path'] == p)
        source = args.input.parent/p if item is freeze['rubric'] else args.input/'corpus'/p
        actual = sha(source.read_bytes())
        assert actual == item['sha256'] == b['actual'] == b['expected'] == g['sha256'] == g['expected']
        assert b['match'] and g['matches']
        if 'lines' in item:
            assert len(source.read_bytes().splitlines()) == item['lines'] == g['lines']
        hashes.append({'path': p, 'sha256': actual, 'both_records_match': True})
    rfc = subprocess.check_output(['git','show',freeze['rfcCommit']+':llp/4001-snapback5-sql-front-end.rfc.md'], cwd=ROOT)
    assert sha(rfc) == bh['rfc_sha256']
    assert (args.input.parent/freeze['rubric']['path']).read_bytes() in rfc

    # Inventory only: re-use the builder's committed mechanical AST walker.
    spec = importlib.util.spec_from_file_location('inventory', HERE/'builder/parse_corpus.py')
    inv = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(inv)
    inventory, _, _ = inv.inventory(args.input)
    bmeta = {u['id']: u for u in inventory}
    builder, blind = read_units('builder'), read_units('blind')
    bm = {u['id']: u for u in builder}
    gm = {u['id']: u for u in blind}
    assert set(bmeta) == set(bm)

    # Extract only the blind parser's enumeration functions, never its judgments.
    parsed = ast.parse((HERE/'blind/parse_classify.py').read_text())
    selected = [n for n in parsed.body if isinstance(n, ast.FunctionDef) and n.name in ('iter_pl_statements','pl_kind')]
    ns = {}
    exec(compile(ast.Module(body=selected, type_ignores=[]), '<blind-enumerator>', 'exec'), ns)
    assert len(selected) == 2
    gmeta = {}
    skipped = {'CONSTR_NULL','CONSTR_NOTNULL','CONSTR_DEFAULT','CONSTR_IDENTITY','CONSTR_GENERATED',
               'CONSTR_ATTR_DEFERRABLE','CONSTR_ATTR_NOT_DEFERRABLE','CONSTR_ATTR_DEFERRED','CONSTR_ATTR_IMMEDIATE'}
    for item in freeze['manifest']:
        file = item['path']
        source = (args.input/'corpus'/file).read_text().replace('{{P}}','ns_')
        parsed_sql = json.loads(inv.parser.parse_sql_json(source))
        for ti, raw in enumerate(parsed_sql['stmts']):
            base = f'{file}:{ti}'
            typ, obj = next(iter(raw['stmt'].items()))
            start = raw.get('stmt_location',0)
            end = start+raw['stmt_len'] if raw.get('stmt_len') else len(source.encode())
            text = source.encode()[start:end].decode()
            gmeta[base] = dict(kind=typ, ast=obj, source=text, group='top')
            children = []
            def emit(kind, value, group):
                children.append(dict(kind=kind, ast=value, group=group))
            def column(col):
                emit('ColumnDef',col,'table_child')
                for c in col.get('constraints',[]):
                    if c['Constraint']['contype'] not in skipped:
                        emit('Constraint',c['Constraint'],'table_child')
            if typ == 'CreateStmt':
                for el in obj.get('tableElts',[]):
                    k,v = next(iter(el.items()))
                    if k == 'ColumnDef':
                        column(v)
                    elif v['contype'] not in skipped:
                        emit(k,v,'table_child')
            elif typ == 'AlterTableStmt':
                for command in obj['cmds']:
                    c = command['AlterTableCmd']
                    d = c.get('def',{})
                    if 'ColumnDef' in d:
                        column(d['ColumnDef'])
                    elif 'Constraint' in d and d['Constraint']['contype'] not in skipped:
                        emit('Constraint',d['Constraint'],'table_child')
                    elif c['subtype'] == 'AT_DropConstraint':
                        emit('DropConstraint',c,'table_child')
                    elif c['subtype'] == 'AT_ColumnDefault':
                        emit('AlterColumnDefault',c,'table_child')
            elif typ in ('CreateFunctionStmt','DoStmt'):
                lang = 'plpgsql'
                if typ == 'CreateFunctionStmt':
                    signature = {k:v for k,v in obj.items() if k != 'options'}
                    signature['options'] = [v for v in obj.get('options',[]) if v['DefElem']['defname'] != 'as']
                    emit('RoutineSignature',signature,'signature')
                    opts = {x['DefElem']['defname']:x['DefElem'].get('arg') for x in obj['options']}
                    lang = opts['language']['String']['sval']
                    body = opts['as']['List']['items'][0]['String']['sval']
                if lang == 'sql':
                    for st in json.loads(inv.parser.parse_sql_json(body))['stmts']:
                        k,v = next(iter(st['stmt'].items()))
                        emit('SQLBody:'+k,v,'sql_body')
                else:
                    for fn in json.loads(inv.parser.parse_plpgsql_json(text)):
                        action = fn.get('PLpgSQL_function',{}).get('action')
                        if action:
                            for k,v,_ in ns['iter_pl_statements'](action):
                                emit(k,v,'do_body' if typ == 'DoStmt' else 'plpgsql_body')
            for ci, child in enumerate(children):
                gid = f'{base}:{ci}'
                assert gid in gm, (gid,child)
                expected = ('column' if child['kind'] in ('ColumnDef','AlterColumnDefault') else
                            'constraint' if child['group'] == 'table_child' else
                            'signature' if child['group'] == 'signature' else
                            'sql_body' if child['group'] == 'sql_body' else ns['pl_kind'](child['kind']))
                assert gm[gid]['kind'] == expected, (gid,gm[gid]['kind'],expected)
                gmeta[gid] = child
    assert set(gmeta) == set(gm)

    # Parent index is offset by one. Within it, join normalized statement ASTs,
    # preserving occurrence order for repeated identical source statements.
    pairs, builder_only, blind_only = [], [], []
    used = set()
    for gid, g in gmeta.items():
        file, *indices = gid.split(':')
        parent = f'{file}:{int(indices[0])+1}'
        if len(indices) == 1:
            candidates = [bmeta[parent]]
        else:
            candidates = [b for b in inventory if b.get('parent') == parent]
        matches = [b for b in candidates if b['id'] not in used and fingerprint(b['kind'],b['ast']) == fingerprint(g['kind'],g['ast'])]
        if not matches:
            blind_only.append(gid)
            continue
        b = matches[0]
        used.add(b['id'])
        attached = []
        if g['kind'] == 'ColumnDef':
            attached = [x['id'] for x in candidates if x['kind'] == 'Constraint' and
                        x['ast_path'].startswith(b['ast_path']+'.constraints[') and x['ast']['contype'] in skipped]
        group = b['group']
        tier = 'body' if group.endswith('_body') else group
        ids = [b['id']]+attached
        cls = max((bm[x]['class'] for x in ids), key=RANK.get)
        pair = dict(tier=tier, group=group, builder_ids=ids, blind_id=gid,
                    builder_class=cls, blind_class=gm[gid]['class'],
                    source=normalize(g.get('source') or ' | '.join(e['query'] for e in inv.own_expressions(g['ast'])) or
                                     json.dumps(g['ast'],ensure_ascii=False)),
                    builder_reading='; '.join(bm[x]['explanation'] for x in ids),
                    blind_reading='; '.join(str(gm[gid][k]) for k in ('raw_refused','post_rewrite_refused','explanation','ambiguity') if gm[gid].get(k)),
                    builder_ambiguity=sorted({a for x in ids for a in bm[x]['ambiguity']}),
                    blind_ambiguity=gm[gid].get('ambiguity'))
        pairs.append(pair)
    attached_used = {x for p in pairs for x in p['builder_ids']}
    builder_only = [x for x in bm if x not in attached_used]
    receipt = dict(hashes=hashes, resolutions_sha256=sha((HERE/'resolutions.md').read_bytes()),
                   ledger_sha256={f:sha((HERE/f/'units.jsonl').read_bytes()) for f in ('builder','blind')},
                   original_counts={'builder':len(builder),'blind':len(blind)},
                   builder_only=builder_only, blind_only=blind_only)
    (args.out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    (args.out/'pairs.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in pairs))
    counts = {}
    for tier in ['top','body','signature','table_child']:
        rows = [p for p in pairs if p['tier'] == tier]
        counts[tier] = dict(pairs=len(rows), agreement=sum(p['builder_class']==p['blind_class'] for p in rows),
                            disagreements=sum(p['builder_class']!=p['blind_class'] for p in rows))
    resolved, changes = resolved_ledgers(builder,blind,pairs,bmeta,gmeta)
    totals = {}
    for family, units in resolved.items():
        metas = bmeta if family=='builder' else gmeta
        totals[family] = {g:bucket([u for u in units.values() if u['group']==g]) for g in ['top','plpgsql_body','sql_body','do_body','signature','table_child']}
        totals[family]['all_body'] = bucket([u for u in units.values() if u['group'].endswith('_body')])
        totals[family]['nonignored_top'] = bucket([u for u in units.values() if u['group']=='top' and u['class']!='ignored'])
        totals[family]['authored_plpgsql'] = bucket([u for u in units.values() if u['group']=='plpgsql_body' and not metas[u['id']].get('parser_inserted')])
    for p in pairs:
        bc = max((resolved['builder'][x]['class'] for x in p['builder_ids']),key=RANK.get)
        gc = resolved['blind'][p['blind_id']]['class']
        p['resolved_builder_class'],p['resolved_blind_class'] = bc,gc
    for tier, count in counts.items():
        count['resolved_disagreements'] = sum(p['resolved_builder_class']!=p['resolved_blind_class'] for p in pairs if p['tier']==tier)
    # A source-preserving alignment receipt, plus a complete disagreement appendix.
    (args.out/'comparison.json').write_text(json.dumps(dict(counts=counts,totals=totals,changes=changes),indent=2)+'\n')
    (args.out/'pairs.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in pairs))
    lines = ['# Every original class disagreement', '',
             'Generated by `reconcile.py` from the unchanged family ledgers. B = builder; G = blind Grok. '
             'All ids below retain their original bases (B one-based; G zero-based). '
             'Column rows compare B’s worst class across the listed column/attribute ids with G’s bundled column. '
             'The complete statement text/AST identity is in `pairs.jsonl`; source excerpts here are only navigation aids. '
             'A blank original rationale means the classifier recorded admission without a per-unit explanation; it is not an invented review.', '']
    for tier in counts:
        lines += [f'## {tier}', '', '| Builder ids; blind id | Source excerpt | Original B / G | Builder rubric reading | Blind rubric reading | Resolved B / G |',
                  '| --- | --- | --- | --- | --- | --- |']
        for p in pairs:
            if p['tier']!=tier or p['builder_class']==p['blind_class']:
                continue
            source = re.sub(r'\s+',' ',p['source'])
            if len(source)>180:
                source = source[:180]+'…'
            vals = ['; '.join(p['builder_ids'])+'; **G:** '+p['blind_id'],source,
                    p['builder_class']+' / '+p['blind_class'],p['builder_reading'],
                    p['blind_reading'] or '(admitted; no per-unit rationale recorded)',
                    p['resolved_builder_class']+' / '+p['resolved_blind_class']]
            lines.append('| '+' | '.join(md(v) for v in vals)+' |')
        lines.append('')
    (args.out/'disagreements.md').write_text('\n'.join(lines).rstrip()+'\n')
    effects = defaultdict(Counter)
    for c in changes:
        e = effects[(c['rule'],c['family'],c['group'])]
        e['changed_units'] += 1
        e['post'] += int(c['after']=='refused')-int(c['before']=='refused')
        e['raw'] += int(c['raw_after'])-int(c['raw_before'])
    lines = ['# Numerical effects of the fixed resolutions', '',
             'Every ruling in resolutions.md not named below changes zero class/raw counts in both families. '
             'Counts here are deltas on each original inventory, not additional units. '
             'Parent propagation is shown separately to avoid attributing the same parent change to several children. '
             'The exact changed ids, old/new classes and raw flags are in comparison.json. '
             'No resolution changes an idiom answer or any stop predicate.', '',
             '| Resolution | Family | Group | Changed units (class or raw flag) | Δ post refusals | Δ raw refusals |',
             '| --- | --- | --- | ---: | ---: | ---: |']
    for (rule,family,group),v in effects.items():
        lines.append(f'| {rule} | {family} | {group} | {v["changed_units"]} | {v["post"]:+d} | {v["raw"]:+d} |')
    lines += ['', 'A-KEYS/B01 covers 67 PRIMARY KEY constraints and 37 text id/reference columns. '
              'B04 affects 28 separately admitted reference constraints; its other recorded occurrences already refused '
              'or repeat a parent. B17 applies §7’s final-catalog instruction: the following ADD replaces '
              'the enum with the registered IN check, so this DROP is admitted catalog work, not ignored boilerplate. '
              'B22 moves the creation alias onto the signature; it changes no refusal.', '',
              'Counting resolutions preserve the original inventories for headline family rates: '
              'A-CHILDREN reconciles 443 attached attributes into 546 comparable bundles (989 builder child nodes); '
              'the blind record has two additional ALTER-default children. '
              'A-SYNTHETIC accounts for six routine and four DO empty RETURN nodes. '
              'A-SQL-BODY adds 18 units and A-DO adds 13 to the builder narrow body denominator; '
              'the blind combined denominator already includes 18 SQL and nine authored DO units. '
              'README shows each denominator with its numerator, so these are not concealed rate changes.', '',
              'Original blind raw refusal meant every rewritten/refused unit. The resolution overlay applies '
              'A-PROBE-CLASS: exact recognized probe calls/bodies are rewrite work but not raw refusals. '
              'UUID signatures remain raw refusals. Both original and resolved raw rates remain reported.', '']
    (args.out/'resolution-effects.md').write_text('\n'.join(lines))
    # The numerical stopping predicates must remain true; idiom answers are
    # separately evidenced human judgments in README, not inferred from rates.
    for family in totals:
        for scope in ('top','nonignored_top','plpgsql_body','authored_plpgsql','all_body'):
            t = totals[family][scope]
            assert t['post']*3 > t['n'], (family,scope,t)
    print(json.dumps({'comparison':counts,'totals':totals,'changes':len(changes),'builder_only':builder_only,'blind_only':blind_only},indent=2))


if __name__ == '__main__':
    main()
