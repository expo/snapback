# Snapback 4: a named lookup on an optional unique key asks for a cap; the positional key compiles

- Opened: 2026-10-03
- Area: Snapback 4 language (`snapback4-lang` binder, lookup planning and diagnostics)
- Source: calibration #29's run log, line 30 (`benchmarks/runs/2026-10-02-snapback4-clique-astra-0.4.11/astra/lane-run-log.md`), attributed "ambiguous"; the scorer did not charge it.

## Observed

Calibration #29's DM table keys each direct conversation by a sorted principal pair. Both columns are optional, because group rows have neither:

```quarry
table conversations:
  low: principal ?
  high: principal ?
  unique low, high
query direct(other: principal):
  (low, high) = sorted(viewer, other)
  return conversations[low, high]                  # compiles: point lookup on the unique key
# return conversations[low = low, high = high]     # refused
```

The named form is refused with 0.4.11 (and the key order does not matter: `high = high, low = low` and `low = viewer, high = other` are refused too):

```
schema.q:206:10 — E_QUARRY_BOUND: conversations has no cap over this prefix; this position needs a bounded page
  rewrite: declare `cap N by high, low` on conversations, or page with `first N` and a cursor: `conversations where .high = high and .low = low first 50 by .id after c` (declare `c: cursor ?`)
```

With `low: principal` and `high: principal` (required), the same named lookup compiles. The trigger is the optional columns: named equalities over a nullable unique key are planned as a scan, while the positional key over the same columns is planned as a point lookup.

## Why it matters

- The two spellings of the same key disagree, and only one is accepted. The builder lost a loop finding the positional workaround.
- The rewrite is wrong for this shape. A cap or a page of DM conversations is not what the author wants; the unique key already answers with at most one row whenever both arguments are non-null.

## Expected

Decide one meaning for an equality on a nullable unique-key column, and apply it to both spellings. Either:
- a named lookup whose equalities exactly cover a unique key is a point lookup, with the same null rule as the positional key; or
- if a null argument must stay able to match many null rows, the diagnostic says so and names the positional key `conversations[low, high]` (or a non-null guard) as the rewrite, instead of a cap.

Add a guide sentence under `guide indexes` or `guide reads` saying how null arguments behave in key lookups.

## Reproduction

Copy the calibration #29 source (`.../astra/source/snapback/{schema.q,windows.q,workers/push.mjs}`), change line 206 to the named form, and run `snapback4 check`.

## Resolved — 2026-10-03, Lane NL

Exact named equalities over a plain unique key now select a point in either
order, including nullable columns. Round 1 supersedes the initial null rule:
every argument on a nullable column of the selected key must be provably
non-null (required type or guard). Otherwise both spellings and `exists`
refuse with `E_QUARRY_NULL_KEY`, explaining replica-ambiguous null ties and
offering a guard, an explicitly bounded population, or an id lookup. No cap
is suggested as a repair of the point itself. Partial keys still need bounds.
Required-key null arguments address nothing. Storage null-bearing uniqueness,
population equality and maintained aggregate null groups are unchanged.

Point plans match when both spellings select the same index without residual
equalities. A shorter total unique key can instead serve a named lookup with
extra equality checks. Competing nonunique indexes no longer make exact
unique rule probes ambiguous. A nullable unique population repair retains
`by .id` if it compiles; otherwise no rewrite is offered.

Regressions cover server, memory and SQLite, all required/optional and null
combinations of two- and three-column keys, every named order, duplicate
writes, qualified plan identity, and the real calibration #29 source. Its copied app
passes `check` with the named form. The indexes guide and LLP 3000.013 §2.2
document the semantics. A verified diagnostic repair for an aggregate now
adds `by .id` so its population keeps every tied null row.

See the [verification report](../../snapback4/reports/20261003-nl-named-key-lookup/REPORT.md).
