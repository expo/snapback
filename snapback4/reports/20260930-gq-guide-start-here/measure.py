#!/usr/bin/env python3
"""Reproduce physical reading depths; run from any directory in this checkout."""
from pathlib import Path
import hashlib, json, re, subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
BASE = '096a1b78ef9ebceedf936b2293e253e0870c9e03'
GUIDE = Path('snapback4/crates/snapback4-lang/src/guide')
FILES = {'language':'language.rs', 'sync':'sync.rs', 'maintains':'maintains.md',
         'rules':'rules.md', 'prediction':'prediction.rs', 'client':'client.md',
         'search':'search.rs', 'feeds':'feeds.md', 'receipts':'receipts.rs'}
ORDER = ['language','sync','maintains','rules','prediction','client','search','feeds']

def read(path, base=False):
    return subprocess.check_output(['git','show',f'{BASE}:{path}'], cwd=ROOT, text=True) if base else (ROOT/path).read_text()

def render(name, base=False):
    path = GUIDE/FILES[name]
    source = read(path, base)
    if path.suffix == '.md': return source
    # These cards consist of raw literal(s) and explicit include_str leaves.
    return ''.join(raw or read(GUIDE/include, base) for raw, include in
                   re.findall(r'r##"([\s\S]*?)"##|include_str!\("([^"]+)"\)', source))

def fence_end(text, needle=None, nth=0, also=None):
    blocks = list(re.finditer(r'^```(?:quarry|tsx?|text)\n([\s\S]*?)^```$', text, re.M))
    block = next(b for b in blocks if needle in b.group(1) and (also is None or also in b.group(1))) if needle else blocks[nth]
    return text[:block.end()].count('\n') + 1

def start_end(text):
    return len(text.split('\n## Reference',1)[0].rstrip().splitlines())

old = {n:(HERE/'cal27-published'/f'guide-{n}.txt').read_text() for n in FILES}
before = {n:render(n, True) for n in FILES}
after = {n:render(n) for n in FILES}
rows = []
for n in ORDER:
    # Client's first snippet is a composer; the measured read pattern is its paged list.
    needle = 'function ConversationList' if n == 'client' else None
    rows.append({'card':n, 'cal27_example_end':fence_end(old[n],needle),
                 'branch_example_end':fence_end(before[n],needle), 'start_end':start_end(after[n]),
                 'cal27_cli_lines':len(old[n].splitlines()), 'branch_card_lines':len(before[n].splitlines()),
                 'after_card_lines':len(after[n].splitlines()),
                 'cal27_sha256':hashlib.sha256(old[n].encode()).hexdigest()})

# Full tasks are deliberately not charged only the short orientation excerpt.
tasks = [
 ('M1 schema, query and insert', 'language', 'query myNotes('),
 ('M1 client paged reads', 'client', 'function ConversationList'),
 ('M2 Following', 'feeds', 'view following:'),
 ('M3/M4 shared rules and child records', 'rules', 'query discussion('),
 ('M3 history sync (sync card actually consulted M8)', 'sync', 'query history('),
 ('M3/M5 receipts including screen seen', 'receipts', 'function useReceipts('),
 ('M4/M5 all three search scopes', 'search', 'query searchChat('),
 ('M6 prediction consultation', 'prediction', 'mutation saveDraft('),
 ('M8 maintained totals consultation', 'maintains', 'view postCount:'),
]
full = []
for task,n,needle in tasks:
    after_needle = 'export function Inbox' if n=='client' else needle
    full.append({'task':task,'card':n,'endpoint':after_needle,
                 'cal27':fence_end(old[n],needle),'branch':fence_end(before[n],needle),
                 'after':fence_end(after[n],after_needle, also='table posts:' if n=='maintains' else None)})

(HERE/'measurement.json').write_text(json.dumps({'base':BASE,'orientation':rows,'task_recipes':full},indent=2)+'\n')
(HERE/'branch-before').mkdir(exist_ok=True)
(HERE/'after').mkdir(exist_ok=True)
for n in FILES:
    (HERE/'branch-before'/f'guide-{n}.txt').write_text(before[n])
    actual = subprocess.check_output([ROOT/'snapback4/target/debug/snapback4','guide',n], cwd=ROOT, text=True)
    assert actual.rstrip()==after[n].rstrip(), n
    (HERE/'after'/f'guide-{n}.txt').write_text(actual)
start = subprocess.check_output([ROOT/'snapback4/target/debug/snapback4','guide','start'], cwd=ROOT, text=True)
(HERE/'guide-start.txt').write_text(start)
lines = ['| Card | 0.4.9 first example ends | Branch first example ends | Start here ends | Full card before → after |',
         '| --- | ---: | ---: | ---: | ---: |']
for x in rows:
    lines.append(f"| {x['card']} | {x['cal27_example_end']} | {x['branch_example_end']} | {x['start_end']} | {x['branch_card_lines']} → {x['after_card_lines']} |")
lines += ['', '| Actual task / consultation | 0.4.9 recipe ends | Branch recipe ends | After recipe ends |',
          '| --- | ---: | ---: | ---: |']
for x in full: lines.append(f"| {x['task']} | {x['cal27']} | {x['branch']} | {x['after']} |")
lines += ['', f'Combined CLI page: {len(start.splitlines())} physical lines, including its final blank line.',
          f"Opening blocks: {sum(x['start_end'] for x in rows)} lines; baseline first-example depths sum to {sum(x['cal27_example_end'] for x in rows)} (0.4.9) / {sum(x['branch_example_end'] for x in rows)} (branch).", '']
(HERE/'MEASUREMENTS.md').write_text('\n'.join(lines))
print('\n'.join(lines))
