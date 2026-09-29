#!/usr/bin/env python3
"""Attribute a symbol-bearing post-bindgen module, and parse production sections.
Usage: attribute.py SYMBOLS_JSON PRODUCTION_WASM OUTPUT_JSON
Shallow bytes are raw costs, not additive compressed costs.
"""
import collections, hashlib, json, re, sys
from pathlib import Path
rows = json.loads(Path(sys.argv[1]).read_text())
classes = collections.Counter(); crates = collections.Counter(); families = collections.Counter()
kept = []
for row in rows:
    n = re.sub(r'\[[0-9a-f]{8,}\]', '', row['name']); size = row['shallow_size']
    if n.startswith(('custom section', '"')): continue
    kept.append({'name':n,'bytes':size})
    # Ownership is the outer concrete namespace, including the implementor
    # for <T as Trait>. Trait- and caller-owned generic code is not split twice.
    m = re.search(r'\b(snapback4_core|snapback4_device|serde_json|serde_core|serde|alloc|core|std|dlmalloc|sha2|digest|wasm_bindgen|js_sys|zmij|itoa|compiler_builtins|__rustc|generic_array|getrandom|block_buffer|memchr)::', n)
    crates[m.group(1) if m else 'module/data/glue'] += size
    c = 'other'
    if n.startswith('data segment'): c = 'data'
    elif re.search(r'serde|serde_json',n):
        c = 'serde deserialize' if re.search(r'Deserializ|::de::|Visitor',n) else 'serde serialize' if re.search(r'Serializ|::ser::',n) else 'serde_json other'
    elif 'btree' in n or 'BTree' in n: c = 'B-tree machinery'
    elif 'slice::sort' in n: c = 'sorting'
    elif re.search(r'fmt::|panick|panic|fmt>|ryu::|dtoa|itoa',n): c = 'formatting/panic'
    elif 'snapback4_core' in n: c = 'core application'
    elif 'snapback4_device' in n: c = 'device application'
    classes[c] += size
    if '::<' in n: families[n.split('::<')[0]] += size
    elif c == 'formatting/panic': families['formatting/panic (non-generic names)'] += size
b=Path(sys.argv[2]).read_bytes(); pos=8

def var():
    global pos
    x=shift=0
    while True:
        v=b[pos];pos+=1;x|=(v&127)<<shift;shift+=7
        if v<128:return x
sections=[]; segments=[]
names=['custom','type','import','function','table','memory','global','export','start','element','code','data','data-count','tag']
while pos<len(b):
    at=pos; kind=b[pos];pos+=1;length=var();start=pos;end=pos+length
    item={'section':names[kind] if kind<len(names) else str(kind),'offset':at,'payloadBytes':length,'framedBytes':end-at}
    if kind==0:
        n=var(); item['name']=b[pos:pos+n].decode(errors='replace')
    if kind==11:
        count=var()
        for i in range(count):
            flags=var()
            if flags==2:var()
            if flags!=1:
                opcode=b[pos];pos+=1;assert opcode==0x41,opcode
                var();assert b[pos]==11;pos+=1
            n=var();data=b[pos:pos+n];pos+=n
            strings=re.findall(rb'[\x20-\x7e]{4,}',data)
            segments.append({'index':i,'bytes':n,'printableAsciiRunsBytes':sum(map(len,strings)),'printableAsciiRuns':len(strings),'nonAsciiOrShortBytes':n-sum(map(len,strings)), 'asciiStringsSha256':hashlib.sha256(b'\0'.join(sorted(strings))).hexdigest(), 'sha256':hashlib.sha256(data).hexdigest()})
    sections.append(item);pos=end
out={'production':{'sha256':hashlib.sha256(b).hexdigest(),'rawBytes':len(b),'sections':sections,'dataSegments':segments},'symbols':{'note':'Separate symbol-bearing post-bindgen counterpart; raw shallow ownership, not additive gzip prices. Inlined callees belong to callers.','attributedBytes':sum(classes.values()),'crates':dict(crates.most_common()),'classes':dict(classes.most_common()),'genericFamilies':dict(families.most_common(40)),'largestFunctions':sorted([r for r in kept if not r['name'].startswith('data segment')],key=lambda x:-x['bytes'])[:35]}}
Path(sys.argv[3]).write_text(json.dumps(out,indent=2)+'\n')
