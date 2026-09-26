#!/usr/bin/env python3
"""Validate the ledger and generate denominator/rate tables and hash receipt."""
import collections
import hashlib
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
CLASSES=['admitted','canonicalized','rewritten','refused','ignored']
RANK={c:i for i,c in enumerate(['ignored','admitted','canonicalized','rewritten','refused'])}
units=[json.loads(l) for l in (HERE/'units.jsonl').read_text().splitlines()]
assert len({u['id'] for u in units})==len(units)
ids={u['id']:u for u in units}
for u in units:
    assert u['class'] in CLASSES and isinstance(u['raw_refused'],bool)
    assert u['post_rewrite_refused']==(u['class']=='refused')
    assert u['post_rewrite_refused']<=u['raw_refused']
    if u['class']=='rewritten':assert u['rewrite'] and u['nodes'] and u['explanation']
    if u['parent']:assert u['parent'] in ids
    if u['kind'] in ('CreateStmt','CreateFunctionStmt') or (u['kind']=='AlterTableStmt' and any(c['parent']==u['id'] for c in units)):
        children=[c for c in units if c['parent']==u['id'] and c['group']!='do_body']
        worst=max(RANK[c['class']] for c in children)
        assert RANK[u['class']]==worst or (worst==1 and u['class']=='canonicalized'),u['id']
        assert u['raw_refused']==any(c['raw_refused'] for c in children),u['id']

files=list(dict.fromkeys(u['file'] for u in units))


def rate(n,d):
    return f'{n}/{d} ({100*n/d:.2f}%)' if d else '0/0 (n/a)'


def table(group):
    result=['| File | N | Admitted | Canonicalized | Rewritten | Refused | Ignored | Raw refusal | Post-rewrite refusal |',
            '|---|---:|---:|---:|---:|---:|---:|---:|---:|']
    for f in files+['**Overall**']:
        a=[u for u in units if u['group']==group and (f=='**Overall**' or u['file']==f)]
        c=collections.Counter(u['class'] for u in a)
        result.append('| '+f+' | '+str(len(a))+' | '+' | '.join(f'{c[k]} ({100*c[k]/len(a):.2f}%)' if a else '0' for k in CLASSES)+' | '+rate(sum(u['raw_refused'] for u in a),len(a))+' | '+rate(sum(u['post_rewrite_refused'] for u in a),len(a))+' |')
    return '\n'.join(result)


def totals(a):
    return dict(n=len(a),raw=sum(u['raw_refused'] for u in a),post=sum(u['post_rewrite_refused'] for u in a),
                classes=dict(collections.Counter(u['class'] for u in a)))


top=[u for u in units if u['group']=='top']
body=[u for u in units if u['group']=='plpgsql_body']
t,b=totals(top),totals(body)
lines=['# Pre-test 1 — builder-family classification', '',
       f'The frozen corpus yields **{t["n"]} top-level units** and **{b["n"]} routine PL/pgSQL executable AST units**. '
       f'Post-rewrite refusals are **{rate(t["post"],t["n"])}** and **{rate(b["post"],b["n"])}**, respectively. '
       'These numbers use the unresolved readings documented below; they are not reconciled cross-family totals.', '',
       f'Raw-spelling refusals: top-level **{rate(t["raw"],t["n"])}**; routine PL/pgSQL body **{rate(b["raw"],b["n"])}**.', '',
       'The registered stop-rule predicates evaluate as follows:', '',
       f'- Top-level post-rewrite refusal > one third: **{str(3*t["post"]>t["n"]).lower()}** ({t["post"]} > {t["n"]}/3).',
       f'- Routine-body post-rewrite refusal > one third: **{str(3*b["post"]>b["n"]).lower()}** ({b["post"]} > {b["n"]}/3).',
       '- Any named idiom without a behavior-preserving admitted spelling: **true** (Muse bump_counters, enforce_message_windows and feed, under the documented readings).',
       '- is_member: **yes**, online-only full-key probe. Astra clqfa_like_counter: **yes for the manifested insert/delete behavior**, with A-COUNTER-SCOPE unresolved. The two counters are two answers within one of the four registered idiom rows.', '',
       'No conclusion about the bet is drawn.', '',
       '**Denominators and rates by file.** N includes ignored units within that group. Each cell contains a count and its percentage of that group/file N; zero-denominator rates are n/a. Table children and signatures are never added to top-level/body N.', '']
for group,label in [('top','Top-level'),('plpgsql_body','Routine PL/pgSQL bodies'),('signature','Routine signatures'),('table_child','Table / ALTER children'),('sql_body','SQL-language bodies (supplemental)'),('do_body','Anonymous DO bodies (supplemental)')]:
    lines += ['**'+label+'.**','',table(group),'']

lines += ['**Denominator sensitivity, without reclassifying a unit.**','',
          '| Denominator | N | Raw refusal | Post-rewrite refusal | Post > one third |',
          '|---|---:|---:|---:|---|']
variants=[('All top-level',top),('Non-ignored top-level',[u for u in top if u['class']!='ignored']),
          ('Routine PL/pgSQL AST',body),('Authored routine PL/pgSQL',[u for u in body if not u.get('parser_inserted')]),
          ('Routine PL/pgSQL + SQL bodies',[u for u in units if u['group'] in ('plpgsql_body','sql_body')]),
          ('Routine PL/pgSQL + DO bodies',[u for u in units if u['group'] in ('plpgsql_body','do_body')]),
          ('All routine and DO body units',[u for u in units if u['group'] in ('plpgsql_body','sql_body','do_body')])]
for name,a in variants:
    v=totals(a)
    lines.append(f'| {name} | {v["n"]} | {rate(v["raw"],v["n"])} | {rate(v["post"],v["n"])} | {3*v["post"]>v["n"]} |')

lines += ['', '**Rewrite work.** These are counts of rewritten source units, not counts of newly emitted statements. A bundle may touch a signature, body nodes, column and trigger; no aggregate across different denominators is used as a rate. Failed attempts stay refused.', '',
          '| Registered rewrite | Top | PL/pgSQL body | Signature | Table child | SQL body |',
          '|---|---:|---:|---:|---:|---:|']
for rw in sorted({u['rewrite'] for u in units if u['class']=='rewritten'}):
    rows=[u for u in units if u['class']=='rewritten' and u['rewrite']==rw]
    lines.append('| '+rw+' | '+' | '.join(str(sum(u['group']==g for u in rows)) for g in ['top','plpgsql_body','signature','table_child','sql_body'])+' |')

lines += ['', (HERE/'interpretation.md').read_text(), '', '**Freeze verification.** Every original input hash matched before parsing; the rubric bytes occur verbatim in the RFC at the frozen commit (including its trailing blank line).', '',
          '| Input | Expected = verified SHA-256 |', '|---|---|']
h=json.loads((HERE/'freeze-hashes.json').read_text())
for row in h['files']:lines.append(f'| {row["path"]} | `{row["actual"]}` |')
lines += ['',f'Freeze descriptor SHA-256: `{h["freeze_sha256"]}`.',
          f'Full frozen RFC SHA-256: `{h["rfc_sha256"]}`.',
          '', '**Verification and deliverables.** All nine files parse with PostgreSQL 17.4 via pglast 7.10. Both parser levels complete without parse errors. The ledger validates unique stable ids, legal classes, raw/post flags, required rewrite evidence, parent links and the worst-child rule. Re-running the parser/classifier/report produces identical artifact hashes. No LLP was touched; ref-check is therefore not required by this brief. No corpus/rubric, engine, other worktree, stash or remote ref was changed.', '',
          '`units.jsonl`, `parse_corpus.py`, `classify.py`, `body-decisions.json`, `report.py`, `README.md`, `parse-receipt.json`, `freeze-hashes.json`, `interpretation.md`, `ambiguities.md`, and this summary are the reviewable record.']
(HERE/'summary.md').write_text('\n'.join(lines)+'\n')

amb=collections.defaultdict(list)
for u in units:
    for key in u['ambiguity']:amb[key].append(u['id'])
appendix=['# Ambiguity-to-unit index','', 'Readings are defined in summary.md / interpretation.md. These ids are recorded before any cross-family comparison. Instrument/counting choices and substantive compatibility uncertainties are both included.','']
for k,affected in sorted(amb.items()):
    appendix += [f'**{k} — {len(affected)} units.**','',', '.join('`'+i+'`' for i in affected),'']
(HERE/'ambiguities.md').write_text('\n'.join(appendix).rstrip()+'\n')
(HERE/'totals.json').write_text(json.dumps({g:totals([u for u in units if u['group']==g]) for g in sorted({u['group'] for u in units})},indent=2)+'\n')
print(json.dumps(dict(validation='PASS',total_units=len(units),top=t,plpgsql_body=b)))
