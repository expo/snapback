#!/usr/bin/env python3
"""Rebuild the row manifest and report from committed fixtures and captured runs."""
from pathlib import Path
from collections import Counter
import hashlib,json,re,subprocess
ROOT=Path(__file__).resolve().parents[2]
RFC=ROOT/'llp/4001-snapback5-sql-front-end.rfc.md'
STUB=ROOT/'snapback5/stubs'
OUT=ROOT/'snapback5/reports'

def get_rows(text):
    section=''; count=0; rows=[]
    for line in text.splitlines():
        if line.startswith('### 3.'):
            section=line.split()[1];count=0
        mark=re.search(r'\*\*([✓≈✗])\*\*',line)
        if section in ['3.1','3.2','3.3','3.4','3.5','3.6'] and line.startswith('| ') and mark:
            count+=1
            rows.append(dict(id=f'{section}-{count:02}',form=line.split('|')[1].strip(),status=mark[1]))
    return rows

def git_text(rev):
    return subprocess.check_output(['git','show',rev+':llp/4001-snapback5-sql-front-end.rfc.md'],cwd=ROOT,text=True)

revision3=get_rows(git_text('d9f177a434'))
revision4=get_rows(git_text('0a2f2ce4f8'))
current=get_rows(RFC.read_text())
assert [r['id'] for r in current]==[r['id'] for r in revision4]
base={r['id']:r for r in revision4}
q_results={r['project']:r for r in json.loads((OUT/'20260925-quarry-results.json').read_text())}
pg=json.loads((OUT/'20260925-postgres17-run.json').read_text())
assert pg['exit']==0 and pg['stopped']
pg_output=(OUT/'20260925-postgres17-output.log').read_text()
assert 'ALL_SQL_ROWS_COMPLETED\n' in pg_output
sql= (STUB/'form-table.sql').read_text().splitlines()

mapping={}
def put(section,values):
    for i,v in enumerate(values,1):mapping[f'{section}-{i:02}']=v.split(',') if v else []
put('3.1',['social,types','social,effects','types','types','social,types','types,writes','types','types,social','types','types,rules','types','types'])
put('3.2',['social','social,types','social,types','social,types','social','types','social,types','social,types','types','social,types','types','social,types','field-authority,field-authority-visible','sequence','rules,social'])
put('3.3',['rules,social','rules,social','rules','rules,social','rules','rules','rules','rules','',''])
mapping.pop('3.3-10')
put('3.4',['social','social','social','social','social','social','row-keyed','social','social','social','','social','social'])
put('3.5',['social','social','social','social','social','social','social','social','social','social','writes','social','types','social','social','','','','',''])
put('3.6',['writes','writes','writes','writes','writes','writes','writes','writes','social','social','social','writes,social',''])
assert set(mapping)=={r['id'] for r in current}
for row in current:
    rid=row['id'];row['before']=base[rid]['status'];row['after']=row.pop('status')
    row['sql_lines']=[i for i,line in enumerate(sql,1) if line.startswith('\\echo ROW ') and rid in line]
    row['quarry_projects']=mapping[rid]
    if row['before']=='✗':
        assert not mapping[rid]
        row.update(sql='GAP — no spelling',quarry='GAP — no lowered column')
    else:
        assert row['sql_lines'],rid
        assert mapping[rid],rid
        row['sql']='PASS'
        row['quarry']='PASS' if all(q_results[p]['exit']==0 for p in mapping[rid]) else 'FAIL — missing shared-baseline addition'
        assert (row['quarry']=='PASS') == (row['after']!='✗'),rid
(STUB/'rows.json').write_text(json.dumps(current,ensure_ascii=False,indent=2)+'\n')

report='''# LLP 4001 §9 step 3 — Postgres 17 and Quarry form-table verification

**Status:** completed on the assigned checkout, with explicit GAPs; **not a
shared-baseline qualification**. RFC remains Draft. Pre-test 1 was not run.

The starting commit was `d9f177a434082e30dc295a0ed31440e1239bf75c`, branch
`sb5/proposal`. Revision 4 is local commit `0a2f2ce4f8`. Both commits have the
same Snapback 4 subtree, `f301a6910c90123238c26de7a2c6def2f9369843`.
No engine changes, other worktree, push, stash, publication or deployment.
This report and its fixtures are the second local commit.

PostgreSQL is **17.10 (Homebrew)** at `/opt/homebrew/opt/postgresql@17/bin`.
Rust and Cargo are **1.97.0**. Cargo built the unchanged Snapback 4 workspace
once; subsequent `cargo run` checks reused that build. Its only warning was
the existing unused `MustBeShareDummy` trait in vendored tiny_http.

## Scope and outcomes

The row is one physical normative-table row in §3.1–§3.6, including all
alternatives in that row. Prose grammar witnesses are additional and do not
inflate the denominator. ✓/≈ are the RFC's mapping classifications, not
execution verdicts. The machine-readable mapping is
[rows.json](../stubs/rows.json); every admitted SQL row has an executed ROW
marker in [form-table.sql](../stubs/form-table.sql), and every lowering maps
to checked projects under [lowered](../stubs/lowered/).

| Snapshot | Total | ✓ | ≈ | ✗ |
| --- | ---: | ---: | ---: | ---: |
'''
for label,rs in [('Revision 3 (input)',revision3),('Revision 4, before verification',revision4),('After verification',[dict(status=r['after']) for r in current])]:
    c=Counter(r['status'] for r in rs)
    report+=f"| {label} | {len(rs)} | {c['✓']} | {c['≈']} | {c['✗']} |\n"
report+='''
**74 SQL rows PASS; 71 Quarry rows PASS; 3 Quarry rows FAIL and are marked ✗;
8 predeclared GAP rows have neither SQL nor a lowered column.** The three
failed rows occupy four isolated negative projects because field authority
is checked both with and without `readable by audience`.

SQL stubs are IMMUTABLE typed constants with no side effects. The fixed mint
returns one dummy id, not a real allocator. PostgreSQL's FK/RLS/materialized
view behavior and those constants are not Snapback semantics. This exercise
checks executable spellings and binding; it does not implement the SQL
front end, prove IR equivalence, run the future §4 harness, or measure
runtime performance. All 34 fixture routines (including the trigger and both procedures) are
called. Their branches and embedded statements
are exercised by seeded calls, with page/mutation/policy calls under the
non-owner `form_reader` as well as ordinary calls. Expected E_RULE,
NOT_FOUND and CANNOT_FOLLOW_SELF are caught only by harness blocks that
assert the exact error message; unexpected failures abort the session.

## What verification changed

| Row / contract | Observation and correction |
| --- | --- |
| §3.1-02 effect work policy | The first lowering used a quoted file path and `attempts`, which Quarry rejects. Final form is `effect push retry 5 backoff 30s deadline 1h`; SQL has `attempts => 5`. Removed the no-op legacy module argument rather than implying SQL loads a worker. Bare effect remains a separate default-policy witness. |
| §3.1-08 scalar types | Stated that duration literals are ints in Quarry; `time` is integral Unix milliseconds spelled `timestamptz`, never a separate SQL `time` type. Epoch literals and interval helpers execute. |
| §3.2-10 residency | Added an explicit multi-principal membership fixture and clarified that the probe's viewer column determines the lowered `by .principal`; `recipient` remains the direct-row principal option. |
| §3.2-13 field authority / visibility | SQL configuration calls execute, but both proposed Quarry spellings fail: marked ✗ at this checkout. The owner-transition ambiguity is reported, not resolved by changing the engine or baseline spec. |
| §3.2-14 sequence | Generated SQL column executes; Quarry `sequence by` fails: marked ✗. |
| §3.3 grammar / §3.3-06 composed rules | Bare `.flag` / `old.flag` is not a Quarry rule. Required SQL booleans lower explicitly to `= true` (or `!= true` for NOT); corrected fixture binds. |
| §3.4-07 row-keyed maintain | SQL LEFT JOIN aggregate executes; proposed Quarry row-key syntax fails: marked ✗. |
| §3.5-09 streamed aggregate | A global messages count lacks a uniformly decided rule prefix. Qualified SQL and Quarry now pin conversationId; the matching count binds. |
| §3.5-13 list growth | Arguments cannot be reassigned, and general list binary `+` is unsupported. Copy ids into a local, then use its recognized single-item append (`grown = grown + [extra]`) with a typed id argument; cardinality/text-length witnesses bind. |
| §3.5-15 unpaged scans | Unscoped roster failed E_QUARRY_BOUND. Pin conversationId under the member cap/read audience; state the admitted bound requirement. |
| §3.6-09 jobs | A filtered sweep's principal index was mutable: E_JOB_CURSOR_INDEX. Its schema now declares principal immutable; the row states every sweep index uses id/immutable columns. Both sweeps bind. |
| §3.6-02 fixture | A positional one-field upsert is ambiguous between id and principal keys. Use `counters[principal = who]`, the row's full named unique key; no new language rule. |
| Stub emit signature | SQL-language functions cannot accept plain `record`. `once anyelement` accepts heterogeneous `row(...)` keys without lying about the SQL type; all stub functions remain IMMUTABLE constants. |

Revision 4 already repaired the review's six called-body failures: Home's
Following-row cast, expanded composite returns for Home/Global/Trending/
Thread, qualified set_like argument and omitted-id defaults. They all run
in the final transcript. The effect named argument and timestamp zero were
also repaired before that run. Both branches of people terminate; empty
and nonempty range/list cases, nullable comparisons, expression/block
helpers, hidden-miss-preserving shape spelling, jobs and qualified calls
are included. PostgreSQL successful execution is not a witness of future
Snapback disclosure behavior.

## Quarry failures retained as GAPs

| RFC row | Exact final fixture | Observed diagnostic |
| --- | --- | --- |
| §3.2-13 | `field-authority/snapback/schema.q`; `field-authority-visible/snapback/schema.q` | E_QUARRY_TYPE: default for readUpTo must be a literal, now or viewer fitting int; the parser does not recognize the following `written by` / visibility clauses. |
| §3.2-14 | `sequence/snapback/schema.q` | E_QUARRY_SYNTAX: expected the end of the line, got `by`. |
| §3.4-07 | `row-keyed/snapback/schema.q` | E_QUARRY_SYNTAX: unknown maintain property `where`, with subsequent indentation recovery errors; this parser has no row-keyed maintain form. |

LLP 3000.015 is still Draft and its three additions are absent from the
assigned Snapback 4 source tree. No baseline implementation was imported
from another worktree or branch. They must land and these rows be rechecked
before shared-baseline qualification or pre-test 1. Their ordinary-column
lookalikes are never counted as passes for these rows.

## Row-by-row results

SQL line links point to the relevant ROW marker (some DDL rows share setup).
Quarry links name representative programs that were actually bound; when
there is no emitted syntax (RLS enablement, implicit id, default residency)
the surrounding bound declaration is the witness.

| Row | Quarry form | Before → after | Postgres 17 | Quarry check |
| --- | --- | --- | --- | --- |
'''
for r in current:
    sql_result=r['sql']
    if r['sql_lines']:sql_result=f"[PASS](../stubs/form-table.sql#L{r['sql_lines'][0]})"
    q=r['quarry']
    if mapping[r['id']]:
        links=', '.join(f'[{p}](../stubs/lowered/{p}/snapback/schema.q)' for p in mapping[r['id']])
        q=('PASS' if r['quarry']=='PASS' else '**FAIL → ✗**')+' — '+links
    report+=f"| §{r['id']} | {r['form']} | {r['before']} → {r['after']} | {sql_result} | {q} |\n"
report+='''
## Commands and process ownership

Run from `/Users/ccheever/projects/snapback-sb5` unless a different cwd is
shown. The exact expanded initdb/start/psql/stop commands, actual port and
recorded PID are in the transcript below; no running cluster was used.
Every attempt used a fresh `mkdtemp` directory beneath the authorized
`snapback-sb5-pg` root and a free port above 55000, then stopped that exact
postmaster after checking its PID file. All earlier attempts were stopped,
including the failed stub attempt. No process-name kill or cluster reuse.

```sh
# One initial build, cwd snapback4:
CARGO_TARGET_DIR=/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build cargo build --locked -p snapback4
# SQL verification (initdb, start, single psql session, PID-checked stop):
python3 snapback5/stubs/run-postgres.py
# Binding: one invocation per fixture project, reusable optional name filter:
python3 snapback5/stubs/run-quarry.py
python3 snapback5/stubs/run-quarry.py effects types field-authority-visible
python3 snapback5/stubs/run-quarry.py types
python3 snapback5/stubs/run-quarry.py social types
# Generate this report and the machine-readable row results:
python3 snapback5/stubs/write-report.py
# Corpus/reference check:
./ref-check --verbose
```

The requested `cd snapback4 && cargo run -p snapback4 -- check <file>` needs
a project cwd with this CLI: `check` ignores a positional file and discovers
`snapback/schema.q` from cwd. The runner therefore uses
`cargo run --locked --manifest-path /Users/ccheever/projects/snapback-sb5/snapback4/Cargo.toml -p snapback4 -- check <absolute-file>`
from each fixture project. Each project contains only that file plus its
explicit module (social also has `insights.q`). The same checked-out Cargo
workspace and built binary are used; generated clients and incremental
build output stay ignored under stubs. Exact commands and outputs follow.

All raw attempts, including intermediate failures and their corrected
rechecks, are committed as `20260925-postgres17-attempt-*.log` and
`20260925-quarry-*-attempt-*.log`; the final JSON results select the latest
check for each project. Display-only trailing spaces are normalized.

## Final Postgres transcript

```text
'''
report+=pg_output.rstrip()+'\n```\n\n## Final Quarry transcripts\n'
for project in sorted(q_results):
    r=q_results[project]
    report+=f'\n### {project} — exit {r["exit"]}\n\n```text\n'+'\n'.join(r['command'])+'\n'+r['output'].rstrip()+f'\n[exit {r["exit"]}]\n```\n'
report+='\n## Fixture digests\n\n| File | SHA-256 |\n| --- | --- |\n'
for path in [STUB/'snapback.sql',STUB/'form-table.sql',*sorted((STUB/'lowered').glob('*/snapback/*.q'))]:
    report+=f'| `{path.relative_to(ROOT)}` | `{hashlib.sha256(path.read_bytes()).hexdigest()}` |\n'
report+='\n## Reference validation\n\n```text\n'+(OUT/'20260925-verification-ref-check.log').read_text().strip()+'\n```\n'
report+='''
## Review dispositions and stopping point

Every round-3 item, including the choices where reviewers differed, is in
[LLP 4001 §12](../../llp/4001-snapback5-sql-front-end.rfc.md#round-3-dispositions).
The three original reviews have append-only pointers, not fabricated new
verdicts. The journal records the authoring-clarity choices and the missing
baseline. No fourth review, pre-test 1, corpus replay, SQL compiler, runtime
change, performance run, push, or publication occurred.
'''
# Keep captured content readable while removing terminal table padding.
report='\n'.join(line.rstrip() for line in report.splitlines())+'\n'
(OUT/'20260925-form-table-postgres17.md').write_text(report)
print('Rows:',len(current),Counter(r['after'] for r in current))
print('SQL:',Counter(r['sql'] for r in current),'Quarry:',Counter(r['quarry'] for r in current))
print('Report lines:',len(report.splitlines()))
