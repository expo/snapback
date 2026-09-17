import collections, json, re, sys
items = json.load(open(sys.argv[1]))
def args_at(name, start):
    stack = []; parts = []; at = start
    for i in range(start, len(name)):
        c = name[i]
        if c in '<([{': stack.append(c)
        elif c in '>)]}':
            if c == '>' and i and name[i-1] == '-': continue
            if not stack:
                parts.append(name[at:i].strip()); return parts
            stack.pop()
        elif c == ',' and not stack: parts.append(name[at:i].strip()); at = i + 1
    return []
def pair(name):
    patterns = [(r'btree::node::NodeRef<',1), (r'btree::(?:map|set)::(?:BTreeMap|Iter|IterMut|IntoIter|IntoKeys|IntoValues|Keys|Values|ValuesMut|Range|RangeMut|Entry|OccupiedEntry|VacantEntry|ExtractIfInner)<',0), (r'btree::node::(?:LeafNode|InternalNode|BalancingContext)<',0), (r'MapVisitor<',0), (r'clone_subtree::<',0), (r'btree::set::BTreeSet<',-1)]
    for pattern, offset in patterns:
        for m in re.finditer(pattern,name):
            a = args_at(name,m.end())
            if offset == -1 and a and a[0] != '_': return a[0]+', ()'
            if len(a) > offset+1 and '_' not in a[offset:offset+2]: return ', '.join(a[offset:offset+2])
    return '(unresolved)'
def simplify(s):
    for before,after in [('alloc::string::String','String'),('alloc::vec::Vec','Vec'),('alloc::collections::btree::set_val::SetValZST','()'),('snapback4_core::','core::'),('snapback4_device::','device::')]: s=s.replace(before,after)
    return s
bt = collections.defaultdict(lambda:[0,0]); sorts = collections.defaultdict(lambda:[0,0]); bt_total = sort_total = 0; bt_count = sort_count = 0
for item in items:
    name = re.sub(r'\[[0-9a-f]{8,}\]', '', item['name']); size = item['shallow_size']
    if name.startswith(('.debug', '".debug')): continue
    if 'collections::btree::' in name:
        k=simplify(pair(name)); bt[k][0]+=size; bt[k][1]+=1; bt_total+=size; bt_count+=1
    if 'slice::sort::' in name:
        # Sort symbols name the element type as the first generic argument.
        m=re.search(r'::(?:[a-zA-Z0-9_]+)::<',name)
        a=args_at(name,m.end()) if m else []
        k=simplify(a[0] if a else '(unresolved)'); sorts[k][0]+=size; sorts[k][1]+=1; sort_total+=size; sort_count+=1
out={'btree_bytes':bt_total,'btree_items':bt_count,'sort_bytes':sort_total,'sort_items':sort_count,'btree_pairs':dict(sorted(bt.items(),key=lambda p:-p[1][0])),'sort_types':dict(sorted(sorts.items(),key=lambda p:-p[1][0]))}
print(json.dumps(out,indent=2))
