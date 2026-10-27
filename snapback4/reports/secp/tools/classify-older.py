#!/usr/bin/env python3
"""Independent SECP source precision audit. No app execution, third-party modules or source writes.
Usage: python3 /tmp/secp-evidence/classify-older.py
Reads only explicit wave26..29 snapback/schema.q sources and input results JSON.
A false classification refutes this note's stated absence/question, not all security risks.
Unrecognized cases remain real_question with explicit review/uncertainty, never guessed false.
"""
import argparse, collections, datetime, gzip, hashlib, itertools, json, pathlib, re
ROOT=pathlib.Path('/tmp/secp-evidence')
SOURCES=pathlib.Path.home()/'sb4-loop'
CODES='N_EDIT_AFTER_APPROVAL N_GUARD_NOT_CONSUMED N_LOOKUP_FILTERED N_ARGUMENT_GRANT N_SWEEP_DEADLINE N_DEPENDENT_WINDOW N_QUERY_FILTERED'.split()
WAVES=range(26,30)
def sha(b): return hashlib.sha256(b).hexdigest()
def strip(s):
    # Comments are not guards. Preserve -- inside string literals.
    return re.split(r'\s+--',s,1)[0].strip()
def top_split(s,word):
    out=[]; start=0;depth=0;quote=False;i=0
    while i<len(s):
        c=s[i]
        if c=="'": quote=not quote
        if not quote:
            if c in '([': depth+=1
            if c in ')]': depth-=1
            token=' '+word+' '
            if depth==0 and s.startswith(token,i):
                out.append(s[start:i].strip()); i+=len(token);start=i;continue
        i+=1
    return out+[s[start:].strip()]
def unparen(s):
    s=s.strip()
    while s.startswith('(') and s.endswith(')'):
        depth=0;valid=True;q=False
        for i,c in enumerate(s):
            if c=="'":q=not q
            if not q:
                depth+= (c=='(')-(c==')')
                if depth==0 and i<len(s)-1:valid=False;break
        if not valid:break
        s=s[1:-1].strip()
    return s
class Source:
    def __init__(self,w,lane):
        self.path=SOURCES/f'wave{w}'/'apps'/lane/'snapback/schema.q'
        self.raw=self.path.read_bytes(); self.lines=self.raw.decode().splitlines();self.blocks=[];self.tables={};self.fns={}
        for i,l in enumerate(self.lines):
            m=re.match(r'^(table|mutation|query|job|fn|shape) (\w+)',l)
            if m:self.blocks.append(dict(kind=m[1],name=m[2],start=i+1,end=len(self.lines)))
        # Stop at any top-level declaration, not just recognized block starts.
        for b in self.blocks:
            for j in range(b['start'],len(self.lines)):
                l=self.lines[j]
                if l and not l[0].isspace() and not l.startswith('--'):
                    b['end']=j;break
            b['text']='\n'.join(self.lines[b['start']-1:b['end']])
            if b['kind']=='table':
                b['read']=None;b['immutable']=set();b['conditional_immutable']={};b['unique']=[];b['columns']={}
                for j in range(b['start'],b['end']):
                    l=strip(self.lines[j]);m=re.match(r'(\w+): (.+)',l)
                    if m:b['columns'][m[1]]=dict(type=m[2],line=j+1)
                    if l.startswith('read <-'): b['read']=(j+1,l[7:].strip())
                    if l.startswith('read through '): b['read']=(j+1,l)
                    if l.startswith('immutable '):
                        ims=l[10:].split(' when ',1);fs=[x.strip() for x in ims[0].split(',')]
                        if len(ims)==1:b['immutable'].update(fs)
                        else:
                            for f in fs:b['conditional_immutable'][f]=(j+1,ims[1])
                    if l.startswith('unique '):b['unique'].append([x.strip() for x in l[7:].split(' else ',1)[0].split(',')])
                self.tables[b['name']]=b
            if b['kind']=='fn':self.fns[b['name']]=b
    def block(self,line):
        a=[b for b in self.blocks if b['kind'] in ('mutation','query','job','fn','shape') and b['start']<=line<=b['end']]
        assert len(a)==1,(self.path,line,a)
        return a[0]
    def ev(self,lines):
        return [dict(file=str(self.path),line=i,text=self.lines[i-1]) for i in sorted(set(lines)) if 0<i<=len(self.lines)]
    def refs(self,b):
        out={}
        for i in range(b['start'],b['end']):
            m=re.match(r'\s*(\w+) = (\w+)\[([^\[\]]+)\]',self.lines[i])
            if m and m[2] in self.tables:out[m[1]]=(m[2],m[3].strip(),i+1)
        # A helper returning one typed row preserves row identity (no arbitrary helper guessing).
        for i in range(b['start'],b['end']):
            m=re.match(r'\s*(\w+) = (\w+)\((\w+)\)',self.lines[i])
            if not m or m[2] not in self.fns:continue
            f=self.fns[m[2]];rr=[strip(l)[7:] for l in f['text'].splitlines()[1:] if strip(l).startswith('return ')]
            if len(rr)!=1:continue
            fr=self.refs(f)
            if rr[0] not in fr:continue
            rt,key,rl=fr[rr[0]]
            pm=re.match(r'fn \w+\((\w+):',self.lines[f['start']-1])
            if pm and key==pm[1]:out[m[1]]=(rt,m[3],i+1)
        return out
    def conditions(self,b,target):
        """Dominating requires and ancestor true/else paths; no later guards."""
        active=[];facts=[]
        for i in range(b['start'],target):
            l=self.lines[i-1];s=strip(l)
            if not s or s.startswith('--'):continue
            ind=len(l)-len(l.lstrip())
            while active and active[-1][0]>=ind:active.pop()
            if i==target-1:pass
            if s.startswith('require '):
                facts.append((i,s[8:].split(' else ',1)[0],tuple(active)))
            m=re.match(r'(?:if|else if|elif) (.+):$',s)
            if m:active.append((ind,i,m[1]))
        # Recompute ancestors at the target to prevent sibling requires leaking.
        t=self.lines[target-1];ind=len(t)-len(t.lstrip())
        while active and active[-1][0]>=ind:active.pop()
        paths={(a[1],a[2]) for a in active}
        ans=[(i,e) for i,e,p in facts if all((a[1],a[2]) in paths for a in p)]
        ans += [(a[1],a[2]) for a in active]
        # A preceding top-level if with a direct unconditional return cannot
        # reach a subsequent top-level statement on its true branch.
        if ind==2:
            for j in range(b['start'],target):
                l=self.lines[j-1];m=re.match(r'  if (.+):$',l)
                if not m:continue
                end=j+1
                while end<target and (not strip(self.lines[end-1]) or self.lines[end-1].startswith('    ') or self.lines[end-1].lstrip().startswith('--')):end+=1
                body=self.lines[j:end-1]
                if any(re.match(r'    return\b',z) for z in body):ans.append((j,'not ('+m[1]+')'))
        assignments={}
        for j in range(b['start'],target):
            m=re.match(r'\s*(\w+) = (.+)',self.lines[j-1])
            if m and not re.search(r'\b(insert|upsert|update)\b|\[|! else|\w+\(',m[2]):assignments[m[1]]=m[2]
        expanded=[]
        for i,e in ans:
            for name,val in assignments.items():
                e=re.sub(r'(?<![.\w])'+name+r'(?![.\w])',lambda _: '('+val+')',e)
            expanded.append((i,e))
        return sorted(set(expanded))
    def writes(self,b):
        out=[]
        for i in range(b['start'],b['end']+1):
            l=strip(self.lines[i-1])
            if re.search(r'\b(insert|upsert|update) ',l) and '{' in l and l.count('{')>l.count('}'):
                j=i
                while l.count('{')>l.count('}') and j<b['end']:
                    l+=' '+strip(self.lines[j]);j+=1
            m=re.search(r'\b(insert|upsert|update) (\w+)(?:\[([^\n]*?)\])? \{(.*)\}',l)
            if not m:continue
            fields={}
            for term in split_comma(m[4]):
                z=term.split(':',1);fields[z[0].strip()]=z[1].strip() if len(z)==2 else z[0].strip()
            rt=m[2];key=m[3]
            refs=self.refs(b)
            if rt in refs and key is None:rt,key,_=refs[rt]
            out.append(dict(line=i,kind=m[1],table=rt,key=key,fields=fields))
        return out

def split_comma(s):
    parts=[];start=0;depth=0;q=False
    for i,c in enumerate(s):
        if c=="'":q=not q
        if not q:
            if c in '([{':depth+=1
            elif c in ')]}':depth-=1
            elif c==',' and depth==0:parts.append(s[start:i].strip());start=i+1
    return parts+[s[start:].strip()]

def parse(s,src,refs,seen=()):
    s=unparen(s.strip())
    for op in ('or','and'):
        parts=top_split(s,op)
        if len(parts)>1:return (op,tuple(parse(p,src,refs,seen) for p in parts))
    if s.startswith('not '):return ('not',parse(s[4:],src,refs,seen))
    m=re.fullmatch(r'(\w+)\((.*)\)',s)
    if m and m[1] in src.fns and m[1] not in seen:
        body=src.fns[m[1]];rs=[strip(l)[7:] for l in body['text'].splitlines()[1:] if strip(l).startswith('return ')]
        header=body['text'].splitlines()[0]
        hm=re.match(r'^fn \w+\((.*?)\):(?: (.+))?$',header)
        if hm:
            if hm[2]:rs=[hm[2]]
            params=[] if not hm[1] else [x.split(':',1)[0].strip() for x in split_comma(hm[1])]
            args=[] if not m[2] else split_comma(m[2])
            if len(rs)==1 and len(params)==len(args):
                expr=rs[0]
                bindings=dict(zip(params,args))
                expr=re.sub(r'(?<![.\w])('+'|'.join(re.escape(x) for x in params)+r')(?![.\w])',lambda mm: bindings[mm[1]],expr) if params else expr
                return parse(expr,src,refs,seen+(m[1],))
    # Only unique principal rosters justify enum exhaustiveness and alias equivalence.
    m=re.fullmatch(r'exists (\w+)\[(.*)\]',s)
    if m:
        t=src.tables.get(m[1]); terms=split_comma(m[2])
        if t and any(len(u)==1 and u[0] in ('principal','account','user') for u in t['unique']):
            pk=next(u[0] for u in t['unique'] if len(u)==1 and u[0] in ('principal','account','user'))
            if terms and terms[0] in ('viewer',pk+' = viewer'):
                rm=re.search(r"(?:^|,\s*)role = '([^']+)'",m[2])
                if len(terms)==1:return ('existsrole',m[1])
                if rm and len(terms)==2:return ('role',m[1],rm[1])
    m=re.fullmatch(r"(\w+)\.role (=|!=) '([^']+)'",s)
    if m and m[1] in refs and refs[m[1]][1] in ('viewer','principal = viewer'):
        expr=parse(f"exists {refs[m[1]][0]}[viewer, role = '{m[3]}']",src,refs)
        if expr[0]=='role':return expr if m[2]=='=' else ('not',expr)
    m=re.fullmatch(r'(\w+) != null',s)
    if m and m[1] in refs and refs[m[1]][1] in ('viewer','principal = viewer'):
        x=parse(f'exists {refs[m[1]][0]}[viewer]',src,refs)
        if x[0]=='existsrole':return x
    s=re.sub(r'\s+',' ',s)
    return ('atom',s)
def variables(e,out):
    if e[0] in ('or','and'):
        for z in e[1]:variables(z,out)
    elif e[0]=='not':variables(e[1],out)
    elif e[0] in ('role','existsrole'):out.add(('role',e[1]))
    elif e[0]=='atom':out.add(('atom',e[1]))
def evaluate(e,values):
    op=e[0]
    if op=='or':return any(evaluate(x,values) for x in e[1])
    if op=='and':return all(evaluate(x,values) for x in e[1])
    if op=='not':return not evaluate(e[1],values)
    if op=='role':return values[('role',e[1])]==e[2]
    if op=='existsrole':return values[('role',e[1])] is not None
    if e[1]=='true':return True
    if e[1] in ('false','deny'):return False
    return values[('atom',e[1])]
def implies(guard,read,src,refs):
    g=parse(guard,src,refs);r=parse(read,src,refs);vs=set();variables(g,vs);variables(r,vs);vs=sorted(vs)
    domains=[]
    for kind,name in vs:
        if kind=='atom':domains.append([False,True]);continue
        typ=src.tables[name]['columns'].get('role',{}).get('type','')
        m=re.match(r'enum\(([^)]*)\)',typ)
        if not m:return False
        domains.append([None]+re.findall(r"'([^']+)'",m[1]))
    if len(vs)>16:return False
    n=1
    for d in domains:n*=len(d)
    if n>150000:return False
    possible=False
    for val in itertools.product(*domains):
        v=dict(zip(vs,val))
        if evaluate(g,v):
            possible=True
            if not evaluate(r,v):return False
    return possible

def simple_read_rule(expr,src,refs):
    """Exact subset in which an arbitrary supplied key is not an ownership proof."""
    tree=parse(expr,src,refs)
    def valid(e):
        if e[0] in ('and','or'):return all(valid(z) for z in e[1])
        if e[0]=='not':return valid(e[1])
        if e[0] in ('role','existsrole'):return True
        return bool(e[0]=='atom' and re.fullmatch(r"\.\w+ = viewer|viewer = 'service:operator'",e[1]))
    return valid(tree)

# Manual decisions are added below only after actual source review, with bounded matching.
MANUAL_CASES=pathlib.Path(__file__).parent.parent/'data/older-manual-cases.json.gz'
_CASES=json.loads(gzip.decompress(MANUAL_CASES.read_bytes()))
MANUAL=_CASES['MANUAL']
SPOTCHECKS=_CASES['SPOTCHECKS']

def classify(src,n):
    line=n['site']['line'];b=src.block(line);code=n['code'];msg=n['message'];refs=src.refs(b);conds=src.conditions(b,line)
    writes=src.writes(b);sitewrites=[w for w in writes if w['line']==line]
    op=(re.match(r'(?:mutation |query )?(\w+)(?::| writes argument | tests )',msg)[1]);field=None;table=None
    if b['kind'] in ('shape','fn') and b['name']!=op:
        caller=next(x for x in src.blocks if x['name']==op and x['kind'] in ('query','mutation'))
        calls=[i for i in range(caller['start'],caller['end']+1) if re.search(r'\b'+b['name']+r'\b',src.lines[i-1])]
        if len(calls)==1:
            conds=src.conditions(caller,calls[0])+conds;refs={**src.refs(caller),**refs}
    if code=='N_EDIT_AFTER_APPROVAL':
        m=re.match(r'(\w+): (\w+)\.(\w+) can change',msg)
        if m: table,field=m.groups()[1:]
        else:
            m=re.search(r'edit of (\w+)\.(\w+)',msg);assert m,(src.path,n);table,field=m.groups()
        assert any(w['table']==table and field in w['fields'] for w in sitewrites),(src.path,n)
    elif code=='N_ARGUMENT_GRANT':
        m=re.search(r'writes argument (\w+) straight into reader-grant column (\w+)\.(\w+)',msg);assert m
        arg,table,field=m.groups();assert any(w['table']==table and field in w['fields'] for w in sitewrites)
    elif code=='N_GUARD_NOT_CONSUMED':
        m=re.match(r'(\w+): checks (\w+)\.(\w+)',msg)
        if m:table,field=m.groups()[1:]
        else:
            m=re.search(r'unchanged (\w+)\.(\w+) cannot authorize',msg);assert m;table,field=m.groups()
    elif code=='N_LOOKUP_FILTERED':
        m=re.match(r'(?:mutation|query) (\w+): (?:saw )?lookup of (\w+)',msg);assert m and m[1]==op
        table=m[2];assert re.search(r'\b'+table+r'\[',src.lines[line-1]) or any(re.search(r'\b'+a+r'\.'+f+r'\b',src.lines[line-1]) and c['type'].split()[0]==table for a,(rt,_,_) in refs.items() for f,c in src.tables[rt]['columns'].items()),(src.path,n,src.lines[line-1])
    elif code=='N_QUERY_FILTERED':
        m=re.match(r"query (\w+): an explicit caller branch does not establish (\w+)'s",msg)
        if m:table=m[2]
        else:
            m=re.search(r'establishes (\w+) read rule',msg);assert m;table=m[1]
    elif code=='N_DEPENDENT_WINDOW':
        m=re.match(r'(\w+): bounds (\w+)\.(\w+)',msg)
        if m:table,field=m.groups()[1:]
        else:
            m=re.search(r'bounding (\w+)\.(\w+)',msg);assert m;table,field=m.groups()
    elif code=='N_SWEEP_DEADLINE':
        m=re.search(r'column (\w+)\.(\w+)',msg)
        if not m:m=re.search(r'writes column (\w+)\.(\w+)',msg)
        if m:table,field=m.groups()
        assert msg.startswith('mutation '+op+' tests ') or msg.startswith('mutation '+op+': saw tests ')
    method='';reason='';evidence=[b['start'],line]
    for fb in src.fns.values():
        if any(re.search(r'\b'+fb['name']+r'\(',l) for l in b['text'].splitlines()):evidence += list(range(fb['start'],fb['end']+1))
    cl='real_question';uncertain=False
    a_hash=sha(src.raw)
    for entry in MANUAL:
        if entry['code']==code and (not entry.get('table') or entry['table']==table) and entry['lane']==src.path.parents[1].name and op==entry['operation'] and (not entry.get('field') or entry['field']==field) and (not entry.get('waves') or int(src.path.parents[3].name[4:]) in entry['waves']):
            # Exact source hashes prevent manual decisions silently surviving source drift.
            assert a_hash == entry['source_hashes'].get(str(src.path)),('manual context changed',src.path)
            assert sha(b['text'].encode()) in entry['operation_hashes'],('manual source changed',src.path,op)
            return cl_result(entry['class'],entry['method'],entry['reason'],entry['evidence_lines'][str(src.path)],False,table,field,b,src,op)
    if code=='N_EDIT_AFTER_APPROVAL':
        t=src.tables[table]
        if all(w['kind']=='insert' for w in sitewrites if w['table']==table):
            cl='false';method='fresh_insert';reason='This site creates a fresh row; it cannot edit already approved evidence on an existing row.'
        elif implies(' and '.join('('+e+')' for _,e in conds) or 'true',"viewer = 'service:operator'",src,refs):
            cl='false';method='operator_only_edit';reason='Only service:operator may reach this write; it is controlled operator provisioning rather than an unguarded evidence edit.';evidence += [i for i,_ in conds]
        elif field in t['conditional_immutable']:
            cl='false';method='conditional_immutable_guard';freeze=t['conditional_immutable'][field];reason=f'Table freezes {table}.{field} when {freeze[1]}; this explicit conditional immutable guard protects the checked/approved value.';evidence += [freeze[0]]
        elif field in t['immutable']:
            cl='false';method='immutable_column';reason=f'Table declares {table}.{field} immutable; existing rows cannot change it.';evidence += [i for i in range(t['start'],t['end']+1) if 'immutable ' in src.lines[i-1]]
        else:
            relevant=[]
            for i,e in conds:
                for alias,(rt,key,rl) in refs.items():
                    if rt==table and any(w['table']==table and w['key'] in (key,alias,alias+'.id') for w in sitewrites):
                        cols=re.findall(r'\b'+alias+r'\.(\w+)',e)
                        lifecycle=[c for c in cols if re.search(r'(?:status|stage|state|approv|accept|consent|signed|confirm|cancel|complete|closed|returned|paid|locked)',c,re.I)]
                        if lifecycle or (field in cols and re.search(r'\b'+re.escape(alias+'.'+field)+r' = (?:null|false|true)',e)):relevant.extend([i,rl])
            if relevant:
                cl='false';method='same_row_lifecycle_guard';reason='A dominating require/branch checks lifecycle or approval state of the same row being written; the note alleges absence of such a condition.';evidence+=relevant
            else:
                method='no_recognized_edit_gate';reason='Existing-row write has no recognized same-row lifecycle/approval condition. Role or time checks alone do not freeze approved values.';evidence+=list(range(b['start'],b['end']+1));uncertain=True
    elif code=='N_ARGUMENT_GRANT':
        guard=' and '.join('('+e+')' for _,e in conds)
        services=re.findall(r"viewer = '(service:[^']+)'",guard)
        service=next((v for v in services if implies(guard,"viewer = '"+v+"'",src,refs)),None)
        t=src.tables[table]
        insert_rules=[(i,strip(src.lines[i-1])[9:].strip()) for i in range(t['start'],t['end']+1) if strip(src.lines[i-1]).startswith('insert <-')]
        recipient_factors=[]
        if all(w['kind']=='insert' for w in sitewrites):
            for i,rule in insert_rules:
                for factor in top_split(rule,'and'):
                    if re.fullmatch(r"exists \w+\[\."+re.escape(field)+r", role = '[^']+'\]",unparen(factor)):
                        recipient_factors.append(i)
        if service:
            cl='false';method='operator_only_grant';reason=f'A dominating exact {service} guard restricts this grant to the fixed service principal; arbitrary callers cannot select the grantee.';evidence += [i for i,_ in conds]
        elif recipient_factors:
            cl='false';method='table_recipient_role_guard';reason=f'The enforced table insert rule contains a dominating recipient-role check for .{field}; this guard constrains the supplied reader principal even though the operation body does not repeat it.';evidence += recipient_factors
        elif implies(guard,f'{arg} = viewer',src,refs):
            cl='false';method='self_only_grant';reason='Every reaching caller is constrained to grant only to viewer.';evidence += [i for i,_ in conds]
        else:
            method='argument_grant_question';reason='A staff/role guard authorizes callers but does not bind the argument grantee to viewer or an explicitly delegated grant scope. The intended reader grant remains a specification question.';evidence += [i for i,_ in conds];evidence += [v[2] for v in refs.values()]
    elif code=='N_LOOKUP_FILTERED' or code=='N_QUERY_FILTERED':
        t=src.tables[table];read=t['read'];assert read,(src.path,n,t['text'])
        evidence += [read[0]]
        for rt in src.tables.values():
            if 'role' in rt['columns']:
                evidence += [rt['columns']['role']['line']]
                evidence += [i for i in range(rt['start'],rt['end']+1) if strip(src.lines[i-1]).startswith('unique ')]
        for _,e in conds:
            for fname,fb in src.fns.items():
                if fname+'(' in e:evidence += list(range(fb['start'],fb['end']+1))
        while read[1].startswith('read through .'):
            fk=read[1].split('.')[-1];parent=t['columns'][fk]['type'].split()[0];t=src.tables[parent];read=t['read'];assert read
            evidence += [read[0]]
            if not read[1].startswith('read through .'):
                read=(read[0],re.sub(r'(?<![\w.])\.(\w+)',r'__parent_.'+r'\1',read[1]))
        evidence += [i for i,_ in conds];evidence += [v[2] for v in refs.values() if v[2]<line]
        # Read proof is at lookup/return; later conditions do not dominate the lookup.
        facts=[e for _,e in conds]
        if code=='N_LOOKUP_FILTERED' and not src.tables[table]['read'][1].startswith('read through '):
            km=re.search(r'\b'+table+r'\[([^]\n]+)\]',src.lines[line-1])
            if km:
                key=km[1]
                for u in src.tables[table]['unique']:
                    if len(u)==1 and key in ('viewer',u[0]+' = viewer'):facts.append('.'+u[0]+' = viewer')
        if code=='N_QUERY_FILTERED':
            target=strip(src.lines[line-1]); wm=re.search(r'\bwhere (.*?)(?:\bfirst\b|\blast\b|\bafter\b|$)',target)
            if wm:facts.append(wm[1].strip())
        guard=' and '.join('('+e+')' for e in facts) or 'true'
        if implies(guard,read[1],src,refs):
            cl='false';method='dominating_read_implication';reason='Dominating conditions (including an exact query row filter, if present) imply the table read rule using unique-principal enum domains and expanded pure zero-argument helpers.'
        else:
            method='read_authority_not_established';reason='The read rule is not implied by the conditions established at this lookup/query branch. A later guard or existence/role membership alone does not prove read authority.';uncertain=True
            if code=='N_LOOKUP_FILTERED' and not src.tables[table]['read'][1].startswith('read through '):
                km=re.search(r'\b'+table+r'\[(\w+)\]',src.lines[line-1])
                roster=lambda rt: 'role' in src.tables[rt]['columns'] and ['principal'] in src.tables[rt]['unique']
                prior=[(rt,key,rl) for rt,key,rl in src.refs(b).values() if rl<line]
                independent=all(roster(rt) for rt,_,_ in prior)
                header=src.lines[b['start']-1]
                if b['kind']=='fn' and b['name']!=op:
                    cs=next(z for z in src.blocks if z['name']==op and z['kind'] in ('mutation','query'))
                    callsites=[j for j in range(cs['start'],cs['end']+1) if b['name']+'(' in src.lines[j-1]]
                    independent=independent and len(callsites)==1 and all(roster(rt) for rt,_,rl in src.refs(cs).values() if rl<callsites[0])
                param=bool(km and re.search(r'[(,]\s*'+km[1]+r':\s*'+table+r'\b',header))
                if independent and param and simple_read_rule(read[1],src,refs):
                    method='unbound_row_key_question';uncertain=False
                    reason='The lookup key is an arbitrary typed operation/helper argument, and no preceding non-roster read binds it to a caller-owned row. The simple owner/role read rule is not implied by the dominating guards: an admitted caller need not satisfy the per-row ownership branch for that supplied key. Later ownership checks occur after filtering; this is a real read/failure-semantics question, not an exploit claim.'
                    evidence += list(range(b['start'],b['end']+1))
    elif code=='N_GUARD_NOT_CONSUMED':
        # A same-row changed exact state, null->nonnull gate, or duplicate child unique
        # constraint can make repetition fail even while the cited parent guard persists.
        stables=[]
        for w in sitewrites:
            t=src.tables[w['table']]
            if w['kind']=='insert':
                for u in t['unique']:
                    if all(k in w['fields'] and not re.search(r'\b(now|random|uuid)\b',w['fields'][k]) for k in u):
                        # Parent mutable values could change: use only args, viewer, literals,
                        # or immutable source row fields as stable unique components.
                        ok=True
                        for k in u:
                            val=w['fields'][k]
                            if '.' in val:
                                mm=re.fullmatch(r'(\w+)\.(\w+)',val)
                                ok=ok and bool(mm and mm[1] in refs and (mm[2]=='id' or mm[2] in src.tables[refs[mm[1]][0]]['immutable']))
                        if ok:stables.append((w,t,u))
        if stables:
            cl='false';method='unique_replay_barrier';reason='The child is inserted under a declared unique key with repeat-stable components; an identical repeated call cannot insert that transition again.'
            for w,t,u in stables:
                evidence += [i for i in range(t['start'],t['end']+1) if strip(src.lines[i-1]).split(' else ',1)[0]=='unique '+', '.join(u)]
        else:
            barriers=[]
            for w in writes:
                if w['line']!=line and (len(src.lines[w['line']-1])-len(src.lines[w['line']-1].lstrip()) != 2 or any(strip(src.lines[j-1]).startswith('return ') for j in range(min(line,w['line']),max(line,w['line'])))):continue
                for i,e in conds:
                    for a,(rt,key,rl) in refs.items():
                        if rt!=w['table'] or w['key'] not in (key,a,a+'.id'):continue
                        for f,val in w['fields'].items():
                            # Exact one-shot source state changes, including null->timestamp.
                            mm=re.fullmatch(r'(?:'+re.escape(a+'.'+f)+r') = (null|true|false|\x27[^\x27]+\x27)',unparen(e))
                            if mm and val!=mm[1] and (mm[1]=='null' or re.fullmatch(r"true|false|'[^']+'",val)):
                                barriers += [i,rl,w['line']]
            if barriers:
                cl='false';method='same_row_consumed_other_guard';reason='Another dominating same-row state/null guard is changed by this write, preventing the identical transition from reusing it.';evidence+=barriers
            else:
                method='reuse_question';reason='No proven unique-child or consumed same-row guard stops repeating the cited transition. A lasting role/parent permission alone does not answer whether repeats are intended.';evidence+=list(range(b['start'],b['end']+1));uncertain=True
    elif code in ('N_SWEEP_DEADLINE','N_DEPENDENT_WINDOW'):
        method='manual_review_required';reason='Deadline/base relationship needs direct control-flow and scheduled-job review.';evidence+=list(range(b['start'],b['end']+1));uncertain=True
    return cl_result(cl,method,reason,evidence,uncertain,table,field,b,src,op)

def cl_result(cl,method,reason,ev,unc,table,field,b,src,op):
    return dict(classification=cl,method=method,reason=reason,uncertainty=unc,operation=op,source_function=b['name'],table=table,field=field,evidence=src.ev(ev),operation_sha256=sha(b['text'].encode()))

def expand_spotcheck(spot):
    """Regenerate verbatim reviewed excerpts only from exactly bound source bytes."""
    out=dict(spot);p=pathlib.Path(out['source_path']);raw=p.read_bytes()
    assert sha(raw)==out['source_sha256'],('spot-check source changed',str(p))
    lines=raw.decode().splitlines()
    out['evidence_lines']=[dict(file=str(p),line=i,text=lines[i-1]) for i in out['evidence_line_numbers']]
    return out

def run(input_path,output_path,phase):
    raw=input_path.read_bytes();data=json.loads(gzip.decompress(raw) if input_path.suffix=='.gz' else raw);schemas=[x for x in data if x['wave'] in WAVES];assert len(schemas)==200 and collections.Counter(x['wave'] for x in schemas)=={w:50 for w in WAVES}
    notes=[];source_records=[]
    for row in schemas:
        src=Source(row['wave'],row['lane']);source_records.append(dict(wave=row['wave'],lane=row['lane'],path=str(src.path),schema_sha256=sha(src.raw),measurement_sha256_field=row['sha256'],selected_note_count=sum(n['code'] in CODES for n in row['notes'])))
        for index,n in enumerate(row['notes']):
            if n['code'] not in CODES:continue
            a=classify(src,n)
            ident=dict(wave=row['wave'],lane=row['lane'],code=n['code'],file=n['site']['file'],line=n['site']['line'],col=n['site']['col'],operation=a['operation'],table=a['table'],field=a['field'],message=n['message'])
            stable={k:v for k,v in ident.items() if k not in ('message','col')}
            if n['code'] in ('N_LOOKUP_FILTERED','N_QUERY_FILTERED'):stable['col']=ident['col']
            key=sha(json.dumps(stable,sort_keys=True,separators=(',',':')).encode())
            matched=[s['id'] for s in SPOTCHECKS if s['wave']==row['wave'] and s['lane']==row['lane'] and s['code']==n['code'] and s['operation']==a['operation'] and (not s.get('field') or s['field']==a['field']) and (not s.get('table') or s['table']==a['table'])]
            notes.append(dict(identity=ident,identity_sha256=key,stable_identity=stable,measurement_note_index=index,**a,provenance=dict(phase=phase,source_sha256=sha(src.raw),basis='source_only; no before/after disappearance inference',spotcheck_ids=matched,review_mode='manual_category_review' if a['method'].startswith('manual_') else 'conservative_recognizer')))
    counts=[]
    for w in WAVES:
        for c in CODES:
            ns=[n for n in notes if n['identity']['wave']==w and n['identity']['code']==c]
            counts.append(dict(wave=w,code=c,total=len(ns),false=sum(n['classification']=='false' for n in ns),real_question=sum(n['classification']=='real_question' for n in ns),uncertain=sum(n['uncertainty'] for n in ns)))
    out=dict(audit='Independent SECP older-wave precision source audit',scope=dict(waves=list(WAVES),codes=CODES,schemas_evaluated=len(schemas),selected_advisories=len(notes)),generated_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(),input=dict(path=str(input_path),sha256=sha(raw),phase=phase),script=dict(path=str(pathlib.Path(__file__)),sha256=sha(pathlib.Path(__file__).read_bytes()),manual_cases_sha256=sha(MANUAL_CASES.read_bytes())),definitions=dict(false='Source has a concrete guard, immutable/creation restriction, or replay barrier answering the emitted question; not a claim of overall application security.',real_question='The stated source question remains open; not proof of an exploit or of specification violation.',uncertainty='True means conservative fallback needing review; class is real_question pending that review. Counts expose these instead of silently treating recognizer failure as established risk.'),limitations=['Static source audit only; no app execution, reachability testing or calibrated-hole coverage claim.','Baseline operation/table/field/site/message identify a note, never disappearance or survival after a compiler change.','Measurement sha256 field is preserved as opaque provenance; actual schema bytes have independent SHA256.'],schemas=source_records,counts=counts,method_counts=dict(collections.Counter(n['method'] for n in notes)),spotchecks=[expand_spotcheck(z) for z in SPOTCHECKS],notes=notes)
    counts_by_class=collections.Counter(n['classification'] for n in notes)
    coverage=collections.Counter((s['wave'],s['code']) for s in SPOTCHECKS)
    assert all(coverage[(w,c)]>0 for w in WAVES for c in CODES)
    assert len({n['identity_sha256'] for n in notes})==len(notes)
    assert all(n['evidence'] and n['classification'] in ('false','real_question') for n in notes)
    assert sum(c['total'] for c in counts)==len(notes)
    out['validation']=dict(all_200_schemas_read=True,all_emitted_selected_notes_classified=True,unique_stable_identities=True,all_notes_have_concrete_source_evidence=True,spotchecked_every_wave_and_code=True,unresolved_recognizer_fallbacks=sum(n['uncertainty'] for n in notes),class_counts=dict(counts_by_class))
    out['residual_uncertainty']=[
        'Classifies the emitted source question, not full application security or all intended business-policy boundaries.',
        'real_question can describe deliberate staff delegation, repeatable records, or uniform hidden/missing refusal; it is not a defect or exploit verdict.',
        'Read-authority questions are evaluated where the read occurs; ! else NOT_FOUND is recorded but does not itself prove read authority.',
        'An explicit lifecycle guard can refute the alleged absence of a lifecycle condition without proving every possible approved-state policy.',
        'Static recognizers plus documented category/representative manual reviews; no runtime reachability claim.'
    ]
    output_path.write_text(json.dumps(out,indent=2)+'\n')
    print(json.dumps(dict(output=str(output_path),schemas=len(schemas),notes=len(notes),classes=dict(collections.Counter(n['classification'] for n in notes)),uncertain=sum(n['uncertainty'] for n in notes),methods=out['method_counts']),indent=2))
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before',type=pathlib.Path,default=ROOT/'before-default/results.json')
    parser.add_argument('--after',type=pathlib.Path,default=ROOT/'qualified-default/results.json')
    parser.add_argument('--out',type=pathlib.Path,default=ROOT)
    args=parser.parse_args();args.out.mkdir(parents=True,exist_ok=True)
    run(args.before,args.out/'older-before-classifications.json','before')
    run(args.after,args.out/'older-after-classifications.json','after')
