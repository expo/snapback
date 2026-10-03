# Reads — E_SHAPE_EXCEEDS_METER

`check` warns earlier with N_SHAPE_METER for shape-field scans that can outgrow
the default meter, including helper reads. For exact unread totals use a
row-keyed maintained count (`unreadCounts[.id]`; guide views), or a bounded
`first N`/`last N` preview or separate query. `why N_SHAPE_METER` explains
why the warning is advisory and a page limit may still scan rejected rows.

A top-level returned shape carries its page's `next`. A shaped row that cannot
finish is dropped with later rows; continuation reaches the unfinished visible
row first. If the same first shape cannot fit on retry, E_SHAPE_EXCEEDS_METER
refuses instead of repeating an empty page forever. Narrow its nested reads
or move expensive components into separate queries. Non-uniform reads cannot
reveal a hidden continuation position. Independent pages in one object each
need their own continuation owner; one cursor cannot cover lost siblings.
`sort` and `group` operate on their input page and retain that page's coverage.

The rule applies only to a query's top-level returned shape expression,
`return <base> { ... }`: the base is an inline scan or merge, or a variable
with exactly one definition, that definition a read, no reassignment and no
other use anywhere in the program. The binder marks that lowered loop; only
that loop drops a row whose shape the meter starved and every later row.
`next` reaches the unfinished row first. A preceding fully computed row
supplies its exclusive position; otherwise the first unfinished rule-visible
row supplies an inclusive position — provided the page's own materialization was
not cut: a drain-cut merge with no fully computed emission, an opening cut or a
word-limit cut retains no continuation. Following an inclusive cursor that again
starves the same first row's returned shape refuses with E_SHAPE_EXCEEDS_METER
instead of returning an empty page with the same `next`: the message names the
read site and ceiling (8,192 examined rows); bound it (`first N`/`last N`) or
move it out of the returned shape. A shaped collector that is not the returned
expression keeps today's behavior: its empty or partial shape stays on the page,
with the existing continuation ownership and position, without trimming or rewind.
This includes assigned shapes, records, conditionals, helpers, aliases and
collector payloads; some such compositions have no continuation owner.
The answer stays `complete: false` on a meter cut, with `cut: 'meter'` on
devices and uniform server reads; non-uniform server reads keep `cut: null`.
A nested page's cut still makes the answer incomplete.
A collector building a returned value makes the query incomplete if it exits
with rows still unconsumed, even on a short final page.
Every page with more rows needs its own returned
cursor owner; another field's page cannot cover a lost sibling or auxiliary
page. A fully consumed, exhausted scan is complete without an owner, including
an exact-bound scan returned as `count(rows)` (subject to the meter, rules and
device horizon). An auxiliary loop over an intact returned page does not change
its completeness, even if that loop breaks. Repeating a page read never clears
an earlier loss. If an owned page site executes repeatedly, only its final
execution supplies `next`; a continuation lost by an earlier execution still
makes the query incomplete.
