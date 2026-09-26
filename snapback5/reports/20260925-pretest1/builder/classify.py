"""Builder-family judgments against frozen LLP 4001 sections 3 and 7.

Mechanical rules are limited to repeated, explicitly documented forms.
body-decisions.json supplies the reviewed context-dependent body decisions.
No classifier in another family was read or consulted.
"""
import json
from pathlib import Path
from parse_corpus import nodes, names

HERE=Path(__file__).resolve().parent
RANK={'ignored':0,'admitted':1,'canonicalized':2,'rewritten':3,'refused':4}


def verdict(cls, why, rewrite=None, ambiguity=None, raw=None, touched=None):
    return dict(class_=cls, explanation=why, rewrite=rewrite,
                raw_refused=cls in ('refused','rewritten') if raw is None else raw,
                post_rewrite_refused=cls=='refused', ambiguity=ambiguity or [], touched=touched)


def admitted(why='The statement uses the finite statement/expression forms of §3.5–§3.7.'):
    return verdict('admitted',why)


def refused(why, ambiguity=None, rewrite=None):
    return verdict('refused',why,rewrite,ambiguity)


def fnames(value):
    return [names(v['funcname']) for k,v,_ in nodes(value) if k=='FuncCall']


def operators(value):
    return [names(v.get('name',[])) for k,v,_ in nodes(value) if k=='A_Expr']


def type_name(t):
    return names(t.get('names',[])).removeprefix('pg_catalog.')


def classify_column(u):
    a=u['ast']; t=a['typeName']; name=type_name(t); col=a['colname']
    cons=[v['Constraint'] for v in a.get('constraints',[])]
    if t.get('arrayBounds'):
        return refused('An unbounded stored array has no registered §3 column spelling; removing its values/default is prohibited by §7.')
    if name=='uuid':
        if u['file'].startswith('astra-'):
            return refused('The Astra identity path casts replay actor text to uuid and serializes/orders UUID principals for dm pair keys; treating those uses as opaque identity would require a scope ruling before the §7 conversion can be certified.', ['A-UUID-SCOPE'])
        target='snapback.id' if col=='id' else 'snapback.principal'
        return verdict('rewritten',f'Convert UUID column {col} to {target} with the same opaque identity value; no UUID-specific operation on this identity appears in this lane of the manifest.',
                       '§7 UUID identity/principal conversion', ['A-UUID'], touched=[u['ast_path']+'.typeName'])
    if name not in ('text','bool','int8','timestamptz'):
        return refused(f'{name} is absent from the finite §3.1 stored-type spellings; no type-widening or bounded-varchar alias is registered.', ['A-TYPES'] if name in ('int4','varchar') else [])
    if col=='id' and name!='uuid':
        return refused('The authored id uses an ordinary scalar rather than the §3.1 intrinsic snapback.id; §7 registers UUID conversion, not text/numeric id conversion.', ['A-KEYS'])
    if any(c['contype']=='CONSTR_FOREIGN' for c in cons):
        return refused('The reference column is authored as text; §3.1 requires snapback.id and §7 only registers UUID identity/reference conversion.', ['A-KEYS'])
    return admitted(f'The {name} column maps under §3.1; its separately counted constraints/defaults are classified independently.')


def classify_constraint(u):
    a=u['ast']; c=a['contype']
    if c in ('CONSTR_NULL','CONSTR_NOTNULL'):
        return admitted('Explicit column nullability maps to the optional/required §3.1 type.')
    if c=='CONSTR_UNIQUE':
        return admitted('A declared UNIQUE constraint is the §3.2 unique form; nullable keys retain tied null rows as documented by the engine guide.')
    if c=='CONSTR_PRIMARY':
        return refused('Only the intrinsic id primary-key spelling is registered in §3.1; a natural/composite SQL PRIMARY KEY is not a registered alias for UNIQUE plus required columns.', ['A-KEYS'])
    if c=='CONSTR_FOREIGN':
        if a.get('fk_del_action','a')!='a' or a.get('fk_upd_action','a')!='a':
            return refused('ON DELETE/UPDATE cascade or set-null is authored behavior, refused by §3.1/§3.7; no cascade emulation is registered.')
        if a.get('pktable',{}).get('schemaname')=='auth':
            return refused('auth.users is not a declared Snapback table; the identity-domain conversion does not preserve a foreign-key authority/existence constraint.', ['A-UUID'])
        if len(a.get('fk_attrs',[]))>1 or len(a.get('pk_attrs',[]))>1:
            return refused('A composite foreign key is outside the single id-reference form in §3.1.')
        return admitted('The reference relation has the §3.1 no-action spelling; the documented non-enforcement difference is accepted, and the column type is counted separately.')
    if c=='CONSTR_DEFAULT':
        exp=a.get('raw_expr',{}); fs=fnames(exp)
        if u.get('column_type',{}).get('arrayBounds') or type_name(u.get('column_type',{})) in ('json','jsonb'):
            return refused('This typed JSON/array default is not a supported scalar literal default; removing it loses authored behavior (§7).')
        if fs==['pg_catalog.now'] or fs==['now']:
            return admitted('The default now() spelling is explicitly admitted in §3.1.')
        if not fs and set(k for k,_,_ in nodes(exp)).isdisjoint({'TypeCast','A_ArrayExpr'}):
            return admitted('A literal default is admitted by §3.1; the owning column type is a separate unit.')
        return refused('This default is not a literal/now() default in §3.1; UUID/sequence, clock, JSON and array behavior cannot be erased.')
    if c=='CONSTR_CHECK':
        exp=a.get('raw_expr',{}); kinds=[v.get('kind') for k,v,_ in nodes(exp) if k=='A_Expr']
        fs=fnames(exp)
        if 'AEXPR_IN' in kinds and not fs:
            return verdict('canonicalized','The constant IN check canonicalizes to the enum exactly as registered in §3.1/§3.7.')
        if fs==['length'] or fs==['pg_catalog.length']:
            return admitted('The column text-length upper/range bound is the §3.1 text check form.')
        return refused('This CHECK is outside the registered text length, enum, named format, media-bound or cap constraints; arbitrary regex/cross-column/numeric checks have no registered table rewrite.', ['A-CHECKS'])
    return refused(f'{c} has no §3 table spelling (identity/generated sequence is not a per-parent registered sequence).')


def expression_failures(value):
    reasons=[]
    allowed={'now','length','substr','count','sum','cardinality','auth.uid'}
    probes={'clqfm_is_member','clqfm_ever_member','clqfm_is_admin'}
    for f in fnames(value):
        if f.removeprefix('pg_catalog.') not in allowed and f not in probes:
            reasons.append(f'call {f} is outside the admitted expression subset or is not an admitted helper')
    for op in operators(value):
        if op not in ('=','<>','!=','<','<=','>','>=','+','-','*','||'):
            reasons.append(f'operator {op} is outside §3.7')
    for k,v,_ in nodes(value):
        if k in ('WithClause','JoinExpr','RangeFunction','WindowDef'):
            reasons.append(f'{k} has no admitted generic read spelling')
        if k=='SelectStmt':
            if v.get('lockingClause'):reasons.append('FOR UPDATE/locking is not registered')
            if v.get('distinctClause'):reasons.append('DISTINCT is not registered')
            if v.get('groupClause'):reasons.append('a grouped body read is not a declared maintained view')
            if v.get('op')=='SETOP_UNION' and not v.get('all'):reasons.append('UNION distinct is refused')
        if k=='FuncCall' and v.get('agg_distinct'):reasons.append('DISTINCT aggregate is not admitted')
        if k=='CoalesceExpr' and len(v.get('args',[]))!=2:reasons.append('COALESCE is registered with exactly two operands')
        if k=='TypeCast':
            t=type_name(v['typeName'])
            if t in ('json','jsonb','date','time','uuid','regclass'):reasons.append(f'cast to {t} is outside §3.7')
            if t=='interval':
                txt=json.dumps(v.get('arg',{}))
                if ' day' in txt or 'month' in txt:reasons.append('calendar-day/month interval is refused')
        if k=='A_Expr' and v.get('kind') in ('AEXPR_OP_ANY','AEXPR_OP_ALL'):
            reasons.append('ANY/ALL array comparison is not in the finite expression grammar')
    return sorted(set(reasons))


def classify_body(u,top,manual):
    if u['id'] in manual:
        d=manual[u['id']]
        return verdict(d['class'],d['explanation'],d.get('rewrite'),d.get('ambiguity'),d.get('raw_refused'),d.get('nodes'))
    a=u['ast']; kind=u['kind']; exprs=u.get('expressions',[])
    if u.get('parser_inserted'):
        return verdict('admitted','Postgres inserted this empty terminal RETURN; counted literally as an executable AST node.',ambiguity=['A-SYNTHETIC'])
    if u['group']=='do_body':
        return refused('This executable belongs to a refused anonymous migration DO block; it is reported separately from declared-routine bodies.', ['A-DO'])
    if kind=='PLpgSQL_stmt_raise':
        if a.get('elog_level')!=21 or a.get('params') or a.get('options'):
            return refused('Only literal RAISE EXCEPTION codes are registered; NOTICE/formatted raise is not an admitted effect.')
        if 'trigger' in json.dumps(top['ast'].get('returnType',{})):
            return refused('A transition trigger admits only E_RULE; this custom application code cannot be retained here (§3.3).')
        return admitted('A literal RAISE EXCEPTION is the §3.6 mutation require/error form; enclosing signature/guard failures are separate.')
    if kind=='PLpgSQL_stmt_getdiag':return refused('GET DIAGNOSTICS is absent from the §3.6 statement grammar.')
    if kind=='PLpgSQL_stmt_commit':return refused('A procedure/job cannot COMMIT explicitly; engine chunking owns transactions (§3.6).')
    if kind=='PLpgSQL_stmt_dynexecute':return refused('Dynamic EXECUTE is explicitly refused by §3.6.')
    if any(word in ' '.join(e['query'].upper() for e in exprs) for word in ('TG_OP','TG_TABLE_NAME','NEW.','OLD.')) or any(e['query'].upper() in ('NEW','OLD') for e in exprs):
        return refused('Trigger event/image expressions occur outside the exact §3.3 transition bundle; the named bundle analysis determines whether a registered replacement preserves them.', ['A-BODY-CONTEXT'])
    value=u['ast'] if u['group']=='sql_body' else [e['ast'] for e in exprs]
    fail=expression_failures(value)
    if fail:return refused('; '.join(fail)+'.')
    if kind.startswith('SQLBody:'):
        return refused('This SQL body is not an exact policy probe, named shape, or finite admitted read under §3.5; see the signature and source-specific analysis.')
    if kind=='PLpgSQL_stmt_return_query':
        return refused('This joined/JSON/keyset result has no finite §3.5 page/shape spelling; CTE removal or a cursor relabel is not registered equivalence.')
    if kind=='PLpgSQL_stmt_fors':
        return refused('The unbounded table loop lacks an admitted planned-read/pinned-audience or procedure sweep context (§3.5–§3.6).')
    if kind=='PLpgSQL_stmt_execsql':
        parsed=[n for e in exprs for n in e['ast']['stmts']]
        for raw in parsed:
            k,v=next(iter(raw['stmt'].items()))
            if k=='InsertStmt':
                ss=v.get('selectStmt',{}).get('SelectStmt',{})
                if not ss.get('valuesLists'):return refused('INSERT SELECT is explicitly refused in §3.6.')
                if len(ss.get('valuesLists',[]))!=1:return refused('Multiple VALUES rows are not the registered single-row §3.6 insert form.', ['A-MULTI-VALUES'])
                conflict=v.get('onConflictClause',{})
                if conflict.get('action')=='ONCONFLICT_NOTHING' and conflict.get('infer'):
                    return refused('The registered do-nothing insert is targetless; deleting a conflict target can absorb different unique violations.', ['A-CONFLICT'])
                if conflict.get('action')=='ONCONFLICT_UPDATE':
                    targets=conflict.get('targetList',[])
                    if not all(x['ResTarget'].get('val',{}).get('ColumnRef',{}).get('fields',[{}])[0].get('String',{}).get('sval')=='excluded' for x in targets):
                        return refused('The upsert SET values are not exactly matched excluded fields as required by §3.6.')
            if k in ('UpdateStmt','DeleteStmt') and not v.get('whereClause'):
                return refused('Set-based DML has no full unique-key point target (§3.6).')
    if any('||' in e['query'] for e in exprs):
        return refused('Text concatenation/general append is not the registered bounded, initialized list-append spelling (§3.5/§3.7).')
    return admitted()


def classify_policy(u):
    a=u['ast']; fs=fnames(a)
    if 'clqfm_created_by' in fs:
        return refused('created_by is a SECURITY DEFINER scalar read, not an exact EXISTS probe; replacing it is not registered (§3.3).')
    if 'now' in fs:
        return refused('The read policy orders expires_at against now(), refused in §3.3; expire_at would also affect update visibility/expiry behavior, not just this SELECT policy.', ['A-EXPIRY'], '§3.3 read expiry via snapback.expire_at (attempted; not equivalent)')
    if u['file'].endswith('migrate-m7.sql') and any(f.startswith('clqfm_') for f in fs):
        return refused('Inlining the helper leaves an EXISTS membership probe nested inside a messages-key probe; §3.3 permits residual equality/null tests, not nested residual probes.', ['A-NESTED-PROBE'], '§3.3 exact probe-helper inlining (attempted)')
    if any(f.startswith('clqfm_') for f in fs):
        return verdict('rewritten','Inline the complete unique-key membership/admin probe, preserving left_at and role residuals; keep the table online-only and compose both update images (§3.3).',
                       '§7 exact probe-helper inlining',['A-PROBE-CLASS'],raw=False)
    return admitted('The policy uses required owner equality or true; RLS is enabled, authenticated is ignored, and mutable UPDATE images remain separately composed (§3.3).')


def classify_signature(u,top):
    label=u['label']
    if label in ('clqfm_is_member','clqfm_ever_member','clqfm_is_admin'):
        return verdict('rewritten','Use snapback.principal for the UUID user argument and inline only this exact admitted full-key probe; its definer access matches §3.3 probe authority.',
                       '§7 UUID identity/principal conversion; §7 exact probe-helper inlining',['A-UUID','A-PROBE-CLASS'])
    if label=='clqfm_msg_visible':
        return admitted('A stable SQL scalar function is a query under §3.5 precedence; its nullable expression is classified separately.')
    opts=u['ast'].get('options',[])
    if any(v['DefElem']['defname']=='security' and v['DefElem'].get('arg',{}).get('Boolean',{}).get('boolval') for v in opts):
        return refused('SECURITY DEFINER is allowed only for exact probe helpers; this signature is not that exception (§3.3/§3.7).')
    if 'trigger' in json.dumps(u['ast'].get('returnType',{})):
        return refused('This RETURNS TRIGGER declaration is outside the canonical transition bundle; the named counter/window exception requires behavior preservation.')
    return refused('This routine signature carries JSON/unsupported types or SQL-write/procedure behavior outside the finite §3.5 routine classes; no arbitrary signature redesign is registered.')


def classify_top(u,children):
    a=u['ast']; k=u['kind']
    if k=='DropStmt':
        assert a.get('missing_ok')
        return verdict('ignored','DROP IF EXISTS replaces a routine/policy/trigger in this manifest; no live table data or product authority is discarded independently (§7).')
    if k in ('TransactionStmt','GrantStmt'):
        return verdict('ignored','Top-level transaction/privilege deployment boilerplate is explicitly ignored by §7.')
    if k=='CreateExtensionStmt':
        return verdict('ignored','pgcrypto supplies UUID-generation dependency naming here; no crypto behavior appears in the frozen Grok manifest (§7).',ambiguity=['A-EXTENSION'])
    if k=='IndexStmt':
        if a.get('unique'):return refused('This index enforces uniqueness; deleting it loses duplicate behavior, and index-to-constraint conversion is not a registered rewrite (§7).')
        if a.get('accessMethod')=='gin' or any(v.get('expr') for v in [x['IndexElem'] for x in a.get('indexParams',[])]):
            return refused('The search expression index is not redundant performance-only evidence; snapback.search does not preserve this tsvector/normalization search contract.', ['A-SEARCH'], '§3.7 snapback.search (attempted; equivalence not established)')
        return verdict('rewritten',f'Delete performance-only index {a.get("idxname")}: it is nonunique, contains no search expression, and no named merge/index dependency appears anywhere in the frozen manifest.',
                       '§7 remove redundant performance-only index')
    if k in ('InsertStmt','UpdateStmt','DeleteStmt','SelectStmt','LockStmt','DoStmt'):
        return refused('Top-level data/migration/DO/lock/setval work is not a declared operation; wrapping it in a function is not a registered rewrite (§7).')
    if k=='CreateSeqStmt':
        return refused('The source uses one global sequence and a global row_number backfill, not a per-parent assignment; the frozen §3.2 sequence row is also a GAP.', ['A-BASELINE'])
    if k=='CreateTrigStmt':
        return refused('This trigger is neither the canonical §3.3 transition bundle nor a behavior-preserving named counter/window rewrite.')
    if k=='CreatePolicyStmt':return classify_policy(u)
    if k=='AlterTableStmt' and not children:
        sub=[x['AlterTableCmd']['subtype'] for x in a['cmds']]
        if sub==['AT_EnableRowSecurity']:return admitted('RLS enablement is explicitly admitted in §7.')
        if sub==['AT_ColumnDefault']:
            if fnames(a):return refused('The nextval default uses a global SQL sequence; no equivalent per-parent sequence rewrite exists.')
            return admitted('The final catalog change is a literal default admitted in §3.1/§7; the separate data UPDATE remains refused.')
        return refused('REPLICA IDENTITY / this ALTER has no §3 final-catalog spelling; Realtime enrollment is not residency.')
    if children:
        worst=max(children,key=lambda x:RANK[x['class']])
        cls=worst['class']
        if k in ('CreateStmt','CreateFunctionStmt'):
            alias=a.get('if_not_exists') or a.get('replace')
        else:
            alias=any(x['AlterTableCmd'].get('missing_ok') for x in a.get('cmds',[]))
        if cls=='admitted' and alias:cls='canonicalized'
        rw=sorted({c['rewrite'] for c in children if c['rewrite'] and c['class']=='rewritten'})
        return verdict(cls,f'Worst non-ignored child is {worst["id"]} ({worst["class"]}); signature/body or table children have independent denominators.',
                       '; '.join(rw) if cls=='rewritten' else None,
                       raw=any(c['raw_refused'] for c in children),
                       touched=[n for c in children if c['class']=='rewritten' for n in c['nodes']] if cls=='rewritten' else None)
    return refused(f'{k} is not a registered §3/§7 form.')


def classify(units):
    manual=json.loads((HERE/'body-decisions.json').read_text())
    tops={u['id']:u for u in units if u['group']=='top'}
    results={}
    cols={u['parent']+'@'+u['ast_path']:u['ast']['typeName'] for u in units if u['kind']=='ColumnDef'}
    # Preserve requested inventory order after bottom-up classification.
    for u in sorted(units,key=lambda x:x['group']=='top'):
        if u['kind']=='Constraint' and '.constraints[' in u['ast_path']:
            u['column_type']=cols[u['parent']+'@'+u['ast_path'].split('.constraints[')[0]]
        if u['group']=='top':
            children=[v for v in results.values() if v.get('parent')==u['id'] and v['group']!='do_body']
            v=classify_top(u,children)
        elif u['kind']=='ColumnDef':v=classify_column(u)
        elif u['kind']=='Constraint':v=classify_constraint(u)
        elif u['kind']=='DropConstraint':v=admitted('The final catalog enum is replaced by the following registered IN check; classify the drop as a catalog change, not ignored migration (§7).')
        elif u['group']=='signature':v=classify_signature(u,tops[u['parent']])
        else:v=classify_body(u,tops[u['parent']],manual)
        if u['label'] in ('clqfm_is_member','clqfm_ever_member','clqfm_is_admin') and u['group']=='sql_body':
            v=verdict('rewritten','Inline this exact full-key EXISTS probe without dropping its left_at/role residual; members has PRIMARY KEY (conversation_id,user_id).',
                      '§7 exact probe-helper inlining',['A-PROBE-CLASS'],raw=False)
        # Astra named counter bundle: discussed as a conditional successful
        # replay of observed insert/delete writers, not arbitrary SQL updates.
        if u['id'] in ('astra-supabase/schema.sql:78','astra-supabase/schema.sql:80') or u.get('parent')=='astra-supabase/schema.sql:78':
            v=verdict('rewritten','Replace the insert/delete delta trigger with like_count bigint GENERATED ALWAYS AS (snapback.count(\'clqfa_likes\', by => \'post\')) STORED, retaining post visibility and the manifest writer set.',
                      '§7 Astra clqfa_like_counter → generated snapback.count',['A-COUNTER-SCOPE'])
        if u['id'] in ('astra-supabase/schema.sql:75','astra-supabase/schema.sql:75:1','astra-supabase/schema.sql:75:3'):
            v=verdict('rewritten','As part of the named Astra counter bundle, replace the stored integer/default counter by the §3.2 bigint generated snapback.count column; the separate migration backfill remains refused.',
                      '§7 Astra clqfa_like_counter → generated snapback.count',['A-COUNTER-SCOPE'],raw=u['id']!='astra-supabase/schema.sql:75:3')
        if u.get('parser_inserted'):
            v=verdict('admitted','Postgres inserted this empty terminal RETURN; counted literally as an executable AST node.',ambiguity=['A-SYNTHETIC'])
        if u['group']=='top':v['ambiguity'].append('A-PARSER')
        if u['file'].startswith('muse-') and u['group']=='top':v['ambiguity'].append('A-TEMPLATE')
        if u['group']=='table_child':v['ambiguity'].append('A-CHILDREN')
        if u['group']=='sql_body':v['ambiguity'].append('A-SQL-BODY')
        if u['group']=='do_body' or u['kind']=='DoStmt':v['ambiguity'].append('A-DO')
        if u['id'] in ('muse-supabase/db/functions.sql:8','muse-supabase/db/functions.sql:10') or u.get('parent')=='muse-supabase/db/functions.sql:8':v['ambiguity'].append('A-WINDOW')
        if u['id']=='muse-supabase/db/rpcs.sql:6' or u.get('parent')=='muse-supabase/db/rpcs.sql:6':v['ambiguity'].append('A-FEED')
        v['ambiguity']=sorted(set(v['ambiguity']))
        out={k:u[k] for k in ('id','file','kind','group','parent','label','ast_path')}
        out.update({('class' if k=='class_' else k):val for k,val in v.items() if k!='touched'})
        out['nodes']=v['touched'] or [u['ast_path']]
        if 'source' in u:out['source']=u['source']
        if 'expressions' in u:out['expressions']=[e['query'] for e in u['expressions']]
        if 'parser_inserted' in u:out['parser_inserted']=u['parser_inserted']
        if u['kind'] in ('ColumnDef','Constraint','DropConstraint','RoutineSignature'):
            out['ast']=u['ast']
        if u['group']=='sql_body':out['ast']=u['ast']
        results[u['id']]=out
    assert set(manual)<=set(results),set(manual)-set(results)
    for u in results.values():
        assert u['class'] in RANK
        assert u['post_rewrite_refused']==(u['class']=='refused')
        if u['class']=='rewritten':assert u['rewrite'] and u['nodes'] and u['explanation']
    return [results[u['id']] for u in units]
