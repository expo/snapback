import re

def explain(source,shape,missing):
    aliases={};renames={};extracts=[];table=None
    for line in source.splitlines():
        m=re.match(r'^table (\w+)(?: renamed from (\w+))?:',line)
        if m:table=m[2]or m[1];aliases[m[1]]=table;continue
        if line and not line[0].isspace():table=None
        m=re.match(r'^  (\w+):.*\brenamed from (\w+)\b',line)
        if table and m:renames[table,m[2]]=m[1]
        m=re.match(r'^extract (\w+) from (\w+) via (\w+):\s*\{(.*)\}\s*$',line)
        if m:
            mapping={}
            for part in m[4].split(','):
                pair=part.strip().split(':');assert len(pair)==2 and all(re.fullmatch(r'\w+',v.strip())for v in pair),line
                mapping[pair[1].strip()]=pair[0].strip()
            extracts.append((m[1],m[2],mapping,line))
    result=[]
    for parent,fields in missing.items():
        for old in fields:
            possibilities=[]
            target=renames.get((parent,old))
            if target and target in shape['tables'].get(parent,[]):possibilities.append(dict(kind='declared rename',parent=parent,old=old,column=target))
            for child,p,mapping,line in extracts:
                if aliases.get(p,p)!=parent or old not in mapping:continue
                column=mapping[old]
                if column in shape['tables'].get(child,[]) and any(c['parent']==parent and c['child']==child and column in c['columns']for c in shape['children']):
                    possibilities.append(dict(kind='declared extraction',parent=parent,old=old,child=child,column=column,declaration=line))
            assert len(possibilities)==1,('unexplained or ambiguous physical predecessor column absence',parent,old,possibilities)
            result.extend(possibilities)
    return result
