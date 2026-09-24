//! The bounds card. Quarry examples are compiled by tests/guide.rs.
pub(super) const CARD: &str = r##"# Bounds and the meter

Nothing is priced at check. As a program runs, the meter counts examined
rows, index entries, rule probes, steps, heap bytes, output bytes and rows
written against ceilings: 8,192 rows examined, 16,384 index entries, 8,192
rule probes, 1,000,000 steps, 16 MiB heap, 1 MiB output, 1,024 rows written
per mutation; a job's chunk may examine 16,384 rows and write 8,192. A
query past a ceiling returns what it found with `complete: false`; a
mutation aborts with E_BOUND naming the meter, the ceiling and the site
(never the count: it would measure rows the viewer may not read).
`snapback4 check --cost` prints each site's structural class;
`snapback4 test` prints the numbers on your data and names query/persona reads
past half any ceiling without a cut: at most ten lines and a count of the rest.
Loopback `dev` logs actual meter and word cuts with the operation, principal,
site, counters and `snapback4 why <op>`. Repeats are suppressed per operation
and site (at most two lines per minute); the next emitted line includes the
suppressed count. `serve` neither logs these costs nor returns read meters.
A loop is bounded
by a page's `first N`, a schema-capped prefix, a query's meter-bounded prefix, a list's `<=N`, `range`'s int expressions, `walk`'s depth,
or `tokens`' 64. An accumulated list is bounded by the heap meter and its
iterations by the step meter. `while` stays refused.
`range(a, b)` evaluates int expressions once and iterates under the step meter,
without materializing the range. `check --cost` prints `steps ≤ meter`, a
filtered scan as `filter over ≤ examined ceiling`, its reads as `probe × examined`,
and a seek as a prefix. Sorting or grouping a page only processes that page.
`sha256(text)` charges the input's UTF-8 byte length plus one to steps before
hashing, then 64 heap bytes for its fixed lowercase hexadecimal result. A step
cut refuses a scalar query with E_BOUND; a cut on that result allocation returns
`data: null`, `complete: false`, as other query heap cuts do. A mutation rolls
back on either cut.

A query's `for row in t[prefix]:` and a merge lane's source may omit `first N`
when the read rule is uniformly decided by that prefix; they read ascending
until the prefix ends or the meter cuts, and `check --cost` prints `rows ≤ meter`
and `lanes ≤ meter` when no fitting schema cap supplies a static bound.
A loop the meter cuts has no continuation; a total over a group that can outgrow one read is a `maintain`.
A returned or bound page instead needs a schema cap or an explicit page bound.
Mutations and jobs may omit the bound only for a schema-capped group that fits
the examined ceiling; they cannot use a query's meter-bounded prefix domain.

E_QUARRY_BOUND means a boundless prefix is not valid in this position: no
schema cap covers the group, its cap exceeds the examined ceiling, or a
meter-bounded query prefix has a non-uniform read rule. Declare `cap N by cols`
on the table if that is the intended group limit, then read `t[prefix]`, or
page with `first N` and a cursor. For a non-uniform prefix, the rewrite also
names the index columns to pin, as N_NEVER_COMPLETE does. A seek still writes
its explicit page bound. Descending reads keep `last N`.


## The scale certificate

Every successful `check` summarizes how many operations are constant and
which grow with data. `check --cost` starts each operation with its verdict;
`check --json --cost` puts the same certificates in `scale`, including
`class`, `bounds`, `growth_sites` (site, reason and rewrite), and `per_write`.
The existing cost details follow each verdict.

`scale: constant — at most 21 rows examined, 0 probes, 0 lanes` means the
work is independent of corpus size for the declared input bounds. A page
includes its lookahead; a merge includes opening and refilling every lane,
even when lanes overlap, and repeats their authorization allowance. Each
mutation or job scan also includes admission. A walk includes its seed at
depth zero. Shapes and loops multiply their nested reads. A value obtained
by a point read can still make a later range grow with data, including when
assignments carry that value across loop iterations.
Argument bounds appear in JSON. `scale: grows with posts in the domain
posts` means a larger domain can cost more, until a runtime meter cuts it.
These two queries demonstrate the classes:

```quarry
table scalePosts:
  body: text <=500
  public
  online only
query scalePage(c: cursor ?):
  return scalePosts after c first 20 by byId
query scalePopulation():
  n = 0
  for p in scalePosts[]:
    n = n + 1
  return n
```

To make a growing read constant, pin its filter column in the indexed
domain, add a maintained view for a total, or cap the domain when that cap
is a product rule. A page size alone does not bound rows skipped by a
residual filter, a per-row read rule or expiry. Search's word expansion
and additional terms also depend on the data. Even a point lookup may
grow when it passes expired siblings, or recomputes a maintained aggregate
over expiring contributions. The certificate names these cases.

Jobs say `scale: per chunk`; the number of chunks and rows written by the
whole sweep can still grow with its domain. Maintained aggregates, recorded
attribution and Following work appear as per-write costs in the verdict.
Writes use their shared meter allowance, including implicit engine work.
Native modules and external action handlers conservatively say `grows`:
their bodies have no Quarry structure from which to prove independence.

This is a structural certificate, not a latency or complete-result promise.
Its row, probe and write allowances include charges that trigger a refusal;
they can exceed the runtime ceilings shown separately in JSON. Steps, heap
and output can still cut a constant operation. It does not price bytes or steps at
check, change authorization, or replace measurements on your data.

## Refused loops and scans

E_UNBOUND_LOOP means the compiler cannot establish an accepted loop domain
or walk depth. For example, `walk nodes[root] up .parent depth 100` exceeds
the supported depth of 1–64; use `depth 8` for an eight-hop query. Iterate
a bounded page, a bounded list argument, `range(a, b)` or `tokens(text)`
for ordinary loops. A `range` may use int expressions and still runs under
the step meter; there is no `while` form.

E_UNBOUND_SCAN means a compiled scan names a table or index absent from its
schema. For example, keeping a compiled read of `byOwner` after renaming
that index leaves the scan unbound. Update the read's `by` clause and run
`snapback4 check`, then use the regenerated backend together with its
programs. Do not reuse old compiled programs against a new schema.
Compiling and serving refuse it, and a native device checks again; the web device trusts that admission and does not repeat the check, so a hand-built or corrupted backend can still run there.

E_FANOUT means a loop received more items than its declared bound.
For example, a raw program declaring a ten-item loop cannot consume an
array of eleven items. Keep the producer and loop bound consistent; in
Quarry, iterate a bounded list or an explicit `first 10` page and process
remaining work through another page or a job chunk. Increasing a runtime
meter ceiling is not the repair, and silently dropping required work is
not a complete sweep.

## Allocation, completeness and diagnostic context

Heap is a cumulative allocation and binding budget: constructed values,
concatenation and other allocating builtins, local bindings, and owned
copies count. Inspecting a held value's length or sum borrows it; row and
map clones share their immutable image. A heap cut stops a query immediately
with `data: null`, `complete: false`, and no continuation, since an interrupted
scalar or shape has no valid partial answer. Its cut site remains internal;
the meter is available only through dev's default read inspection (CLIENT-AND-OPERATIONS.md §4).
An unfinished maintained lookup or live aggregate uses the same unavailable
query result, preserving zero only for a completed missing-group lookup.
A mutation rolls back with `E_BOUND` as above.
A page whose read rule the prefix does not decide (the deciding fields include a
column the scan does not pin) is never `complete`: the server cannot tell
"no more" from "more you may not see". Scan by an index that leads with
the rule's columns, or read the page on the device (`guide sync`), where the
partition holds exactly what the viewer may read. `check` says so
(`N_NEVER_COMPLETE`), as it notes a query page returned without a cursor
(`N_NO_CURSOR`), a synced table whose groups can grow with no horizon
(`N_NO_HORIZON`), and a merge past 50 lanes (`N_WIDE_MERGE`). A single-group
page omits the cursor note when its bound covers the group cap and that cap
fits the default 8,192-row examined ceiling. Larger caps still need a cursor;
other metered work can also cut a read.
For a page of 50 pinned by `conversationId`, either declare `c: cursor ?`
and page with `after c`, or add `cap 50 by conversationId` to the table if
that is the intended group limit. An unscoped plain page can use `cap 50`.
The cap refuses writes beyond its limit; a per-lane cap does not bound a merge.

When the same code and card occur twice in one text `check`, its card excerpt
prints once under the first occurrence, with the `guide:` pointer kept at
every site. At most three excerpts print per check, each at most 4,096 UTF-8
bytes including its full-card pointer and final newline (12,291 extra bytes
including separating blank lines). A single occurrence stays compact;
`check --json` keeps its structured diagnostics. `why <code>` still opens
the excerpt on demand. Every registered code has a dedicated paragraph on
its default card; `why <code>` names the code and explains it there.
For example, `E_QUARRY_SYNTAX` and `E_QUARRY_UNKNOWN` have mistake-and-repair
sections on `guide language`; `E_QUARRY_PLACEMENT` and `E_EMIT_IN_QUERY`
have theirs on `guide programs`. A diagnostic may point to another card
for its context; if that card lacks a section for the code, `check` keeps
the diagnostic and pointer without an excerpt. Explicit `why <code>`
then labels its fallback to that card's opening."##;
