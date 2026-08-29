#!/usr/bin/env python3
"""Empirical shape census of Snapback demo backends.

Answers: what do real apps actually write, and which shapes does the
declarative (analyzable) language already cover?

Run from the snapback repo root:  python3 census.py
"""
import re, glob, collections, os, sys

FILES = [f for f in glob.glob('demos/*/snapback/*.mjs') if '/generated/' not in f]
DB = r'ctx\s*\.\s*db\s*\.\s*(?:query|get|getMany|uniqueMany)'      # multiline-safe
WRITE_STEP = r"\b(insert|patch|del|deleteWhere|insertEach|replace)\(\s*['\"]([A-Za-z0-9_]+)['\"]"


def blocks(src, ctor):
    """Balanced-brace bodies of ctor({...}) calls."""
    out = []
    for m in re.finditer(re.escape(ctor) + r'\s*\(\s*\{', src):
        i = m.end() - 1
        d = 0
        for j in range(i, len(src)):
            if src[j] == '{':
                d += 1
            elif src[j] == '}':
                d -= 1
                if d == 0:
                    out.append(src[i:j + 1])
                    break
    return out


def arr(b, key):
    m = re.search(key + r"\s*:\s*\[([^\]]*)\]", b)
    return re.findall(r"['\"]([A-Za-z0-9_]+)['\"]", m.group(1)) if m else []


def collect():
    d = collections.defaultdict(list)
    for f in FILES:
        s = open(f, errors='ignore').read()
        for c in ('defineQuery', 'defineLiveQuery', 'defineRelationalQuery',
                  'defineBoundedChildrenQuery', 'defineSearchQuery',
                  'defineSnapshotBatchQuery', 'defineJsQuery', 'defineJsLiveQuery',
                  'defineMutation', 'defineJsMutation', 'defineWriteWithActivity',
                  'defineAction'):
            for b in blocks(s, c):
                d[c].append((f, b))
    return d


def main():
    if not os.path.isdir('demos'):
        sys.exit('run from the snapback repo root')
    d = collect()
    n = lambda *cs: sum(len(d[c]) for c in cs)

    print(f'files scanned: {len(FILES)}\n')

    print('== 1. ESCAPE-HATCH RATE ==')
    rd = n('defineQuery', 'defineLiveQuery', 'defineRelationalQuery',
           'defineBoundedChildrenQuery', 'defineSearchQuery', 'defineSnapshotBatchQuery')
    rj = n('defineJsQuery', 'defineJsLiveQuery')
    wd = n('defineMutation', 'defineWriteWithActivity')
    wj = n('defineJsMutation')
    print(f'  reads : declarative {rd:3d}  js {rj:3d}  -> {100*rj/(rd+rj):.0f}% escape')
    print(f'  writes: declarative {wd:3d}  js {wj:3d}  -> {100*wj/(wd+wj):.0f}% escape')

    print('\n== 2. OPTIMISTIC-PREDICTION ELIGIBILITY ==')
    decl = d['defineMutation']
    single = sum(1 for _, b in decl
                 if len(set(m[1] for m in re.findall(WRITE_STEP, b))) == 1)
    total = len(decl) + wj
    print(f'  needs generated IR + single-table (guide/clients/react.md)')
    print(f'  eligible {single}/{total} = {100*single/total:.0f}% of all mutations')

    print('\n== 3. JS READ SHAPES (inline handlers) ==')
    inline = []
    for f, b in d['defineJsLiveQuery'] + d['defineJsQuery']:
        m = re.search(r'\bhandler\s*:', b)
        if m:
            inline.append((f, b[m.end():]))
    cat = collections.Counter()
    perms = 0
    for f, h in inline:
        if re.search(r'ctx\s*\.\s*permissions', h):
            perms += 1
        nq = len(re.findall(DB, h))
        loop = bool(re.search(r'(for\s*\(|\.map\(|\.forEach\()[^;]{0,300}' + DB, h, re.S))
        agg = bool(re.search(r'\.reduce\(|\.length\b', h)) or bool(re.search(r'\.sort\(', h))
        jsf = bool(re.search(r'\.filter\(', h))
        if loop:
            k = 'C nested/N+1'
        elif nq >= 2:
            k = 'B k independent reads'
        elif nq == 1 and agg:
            k = 'D single read + JS aggregate/sort'
        elif nq == 1 and jsf:
            k = 'A2 single read + JS filter'
        elif nq == 1:
            k = 'A1 single read, no JS logic'
        else:
            k = 'E no db read'
        cat[k] += 1
    for k in sorted(cat):
        print(f'  {k:34s} {cat[k]:3d}  ({100*cat[k]/len(inline):.0f}%)')
    a = cat['A1 single read, no JS logic'] + cat['A2 single read + JS filter']
    print(f'  -> gratuitous escape (A1+A2): {a}/{len(inline)} = {100*a/len(inline):.0f}%')
    print(f'  -> needs composition  (B+C) : {cat["B k independent reads"]+cat["C nested/N+1"]}'
          f'  of which k-ary-shaped: {cat["B k independent reads"]}')
    print(f'  -> uses ctx.permissions (multi-hop auth): {perms}')

    print('\n== 4. JS MUTATION SHAPES (declared reads/writes) ==')
    js = [b for _, b in d['defineJsMutation']]
    multi = sum(1 for b in js if len(set(arr(b, 'writes'))) > 1)
    reads = sum(1 for b in js if arr(b, 'reads'))
    print(f'  multi-table writes        {multi}/{len(js)} ({100*multi/len(js):.0f}%)')
    print(f'  declares non-empty reads  {reads}/{len(js)} ({100*reads/len(js):.0f}%)')
    loops = 0
    for f, b in d['defineJsMutation']:
        m = re.search(r'\bhandler\s*:', b)
        if m and re.search(r'(for\s*\(|\.map\(|\.forEach\()', b[m.end():]):
            loops += 1
    print(f'  inline handlers using loops {loops}')
    print('  NOTE: declarative plans support multi-table, get/guard/elseError,')
    print('        insertEach, deleteWhere and runtimeNow() — see')
    print('        guide/backend/declarative-plans.md (likePost writes 2 tables')
    print('        with a conditional refusal). So multi-table and read-before-write')
    print('        are NOT evidence that the plan language is insufficient.')


if __name__ == '__main__':
    main()
