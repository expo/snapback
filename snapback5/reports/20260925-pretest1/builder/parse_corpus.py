#!/usr/bin/env python3
"""Frozen-corpus AST inventory. Run with pglast==7.10, PostgreSQL 17.4.

No semicolon splitting. This is a census and a human classification ledger,
not an implementation of the proposed Snapback compiler.
"""
import argparse
import hashlib
import json
import pathlib
import subprocess

import pglast
from pglast import parser

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[3]
DEFAULT_INPUT = pathlib.Path('/Users/ccheever/projects/snapback-sb5-program/pretest1')


def sha(b):
    return hashlib.sha256(b).hexdigest()


def nodes(value, path='$'):
    if isinstance(value, dict):
        for k, v in value.items():
            yield k, v, path + '.' + k
            yield from nodes(v, path + '.' + k)
    elif isinstance(value, list):
        for i, v in enumerate(value):
            yield from nodes(v, f'{path}[{i}]')


def names(xs):
    return '.'.join(x['String']['sval'] for x in xs)


def own_expressions(stmt):
    """Expressions owned by this statement, including ELSIF conditions.

    Descendant executable nodes are separately counted and classified.
    """
    result = []
    def visit(v):
        if isinstance(v, dict):
            for k, x in v.items():
                if k.startswith('PLpgSQL_stmt_'):
                    continue
                if k == 'PLpgSQL_expr':
                    result.append(x)
                else:
                    visit(x)
        elif isinstance(v, list):
            for x in v:
                visit(x)
    visit(stmt)
    return result


def expression_ast(expr):
    q, mode = expr['query'], expr.get('parseMode', 0)
    if mode in (3, 4, 5):
        # libpg_query returns a complete assignment; use its scanner to
        # locate the assignment operator, then parse the RHS as an expression.
        tok = next(t for t in parser.scan(q) if t.name in ('COLON_EQUALS', 'ASCII_61'))
        q = q[tok.end + 1:]
    if mode:
        q = 'SELECT ' + q
    return json.loads(parser.parse_sql_json(q))


def inventory(input_dir):
    assert pglast.__version__ == 'v7.10'
    assert parser.get_postgresql_version() == (17, 4)
    freeze = json.loads((input_dir / 'freeze.json').read_text())
    hashes = []
    for item in [freeze['rubric']] + freeze['manifest']:
        p = input_dir.parent / item['path'] if item is freeze['rubric'] else input_dir / 'corpus' / item['path']
        actual = sha(p.read_bytes())
        assert actual == item['sha256'], p
        hashes.append(dict(path=item['path'], expected=item['sha256'], actual=actual, match=True))
    rfc = subprocess.check_output(['git', 'show', freeze['rfcCommit'] + ':llp/4001-snapback5-sql-front-end.rfc.md'], cwd=ROOT)
    rubric = (input_dir.parent / freeze['rubric']['path']).read_bytes()
    assert rubric in rfc  # Includes the blank line before section 8.
    receipt = dict(rfc_commit=freeze['rfcCommit'], freeze_sha256=sha((input_dir/'freeze.json').read_bytes()),
                   rfc_sha256=sha(rfc), rubric_verbatim_in_rfc=True,
                   pglast=pglast.__version__, postgres=parser.get_postgresql_version(), files=hashes)
    units, parse_receipts = [], []
    for item in freeze['manifest']:
        file = item['path']
        original = (input_dir/'corpus'/file).read_text()
        # The source explicitly declares this placeholder expansion. Six bytes
        # replace five, so offsets below are explicitly in the expanded source.
        source = original.replace('{{P}}', 'clqfm_')
        ast = json.loads(parser.parse_sql_json(source))
        parse_receipts.append(dict(file=file, original_sha256=item['sha256'],
                                   expanded_sha256=sha(source.encode()),
                                   substitutions=original.count('{{P}}'), top_level=len(ast['stmts'])))
        for ti, raw in enumerate(ast['stmts'], 1):
            typ, obj = next(iter(raw['stmt'].items()))
            start = raw.get('stmt_location', 0)
            stop = start + raw['stmt_len'] if raw.get('stmt_len') else len(source.encode())
            text = source.encode()[start:stop].decode()
            base = f'{file}:{ti}'
            child = 0
            def emit(kind, data, path, label='', expression_data=None, group='top'):
                nonlocal child
                if group != 'top':
                    child += 1
                u = dict(id=base if group == 'top' else f'{base}:{child}', file=file,
                         kind=kind, group=group, parent=None if group=='top' else base,
                         label=label, ast_path=path, ast=data)
                if expression_data is not None:
                    u['expressions'] = expression_data
                units.append(u)
                return u
            top = emit(typ, obj, '$.stmt.'+typ, obj.get('relation',{}).get('relname',''))
            top['source'] = text
            top['expanded_byte_start'] = start
            if typ == 'CreateStmt':
                for i, elt in enumerate(obj.get('tableElts', [])):
                    et, ev = next(iter(elt.items()))
                    ep = f'$.stmt.CreateStmt.tableElts[{i}].{et}'
                    emit(et, ev, ep, ev.get('colname',ev.get('conname',ev.get('contype',''))), group='table_child')
                    if et == 'ColumnDef':
                        for j, con in enumerate(ev.get('constraints', [])):
                            emit('Constraint', con['Constraint'], f'{ep}.constraints[{j}].Constraint',
                                 ev['colname']+':'+con['Constraint']['contype'], group='table_child')
            elif typ == 'AlterTableStmt':
                for i, cmd in enumerate(obj['cmds']):
                    c = cmd['AlterTableCmd']
                    definition = c.get('def',{})
                    if 'ColumnDef' in definition:
                        col = definition['ColumnDef']; p=f'$.stmt.AlterTableStmt.cmds[{i}].AlterTableCmd.def.ColumnDef'
                        emit('ColumnDef',col,p,col['colname'],group='table_child')
                        for j, con in enumerate(col.get('constraints',[])):
                            emit('Constraint',con['Constraint'],f'{p}.constraints[{j}].Constraint',col['colname']+':'+con['Constraint']['contype'],group='table_child')
                    elif 'Constraint' in definition:
                        emit('Constraint',definition['Constraint'],f'$.stmt.AlterTableStmt.cmds[{i}].AlterTableCmd.def.Constraint',c.get('name',''),group='table_child')
                    elif c['subtype']=='AT_DropConstraint':
                        emit('DropConstraint',c,f'$.stmt.AlterTableStmt.cmds[{i}].AlterTableCmd',c.get('name',''),group='table_child')
            elif typ in ('CreateFunctionStmt','DoStmt'):
                if typ == 'CreateFunctionStmt':
                    top['label']=names(obj['funcname'])
                    signature={k:v for k,v in obj.items() if k!='options'}
                    signature['options']=[v for v in obj.get('options',[]) if v['DefElem']['defname']!='as']
                    emit('RoutineSignature',signature,'$.stmt.CreateFunctionStmt',top['label'],group='signature')
                    opts={x['DefElem']['defname']:x['DefElem'].get('arg') for x in obj['options']}
                    lang=opts['language']['String']['sval']
                    body=opts['as']['List']['items'][0]['String']['sval']
                else:
                    lang='plpgsql'
                if lang=='sql':
                    for i, sql in enumerate(json.loads(parser.parse_sql_json(body))['stmts']):
                        st,sv=next(iter(sql['stmt'].items()))
                        emit('SQLBody:'+st,sv,f'$.sql_body.stmts[{i}].stmt.{st}',top['label'],group='sql_body')
                elif lang=='plpgsql':
                    pl=json.loads(parser.parse_plpgsql_json(text))
                    top['plpgsql_ast']=pl
                    for k,v,path in nodes(pl):
                        if k.startswith('PLpgSQL_stmt_') and k!='PLpgSQL_stmt_block':
                            expressions=[]
                            for exp in own_expressions(v):
                                expressions.append(dict(query=exp['query'],parse_mode=exp.get('parseMode',0),ast=expression_ast(exp)))
                            unit=emit(k,v,path,top['label'],expressions,'plpgsql_body' if typ=='CreateFunctionStmt' else 'do_body')
                            unit['parser_inserted']=not bool(v.get('lineno'))
    return units, receipt, parse_receipts


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--input',type=pathlib.Path,default=DEFAULT_INPUT)
    ap.add_argument('--inventory-only',action='store_true')
    args=ap.parse_args()
    units, hashes, receipts=inventory(args.input)
    (HERE/'freeze-hashes.json').write_text(json.dumps(hashes,indent=2)+'\n')
    (HERE/'parse-receipt.json').write_text(json.dumps(receipts,indent=2)+'\n')
    # Full AST retained in local scratch for the review; committed units retain
    # exact AST paths, expression text and source to make decisions reviewable.
    scratch=ROOT/'snapback5/.venv/corpus-inventory.json'
    scratch.write_text(json.dumps(units,indent=2)+'\n')
    if not args.inventory_only:
        from classify import classify
        classified=classify(units)
        (HERE/'units.jsonl').write_text(''.join(json.dumps(u,ensure_ascii=False)+'\n' for u in classified))
    print(json.dumps(dict(units=len(units),groups={g:sum(u['group']==g for u in units) for g in sorted({u['group'] for u in units})})))


if __name__=='__main__':
    main()
