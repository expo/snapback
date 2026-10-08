# Snapback 4: an omitted optional mutation argument is not `= null`, and the write clears the column

Status: Open
Date: 2026-10-08
Scope: Quarry optional arguments in mutations (core: binder/interpreter); docs (`guide writes`, `guide types`)

A mutation with an optional argument used `if arg = null` to decide whether
to update a column. Called with the argument omitted, `arg = null` was
false, the update ran with the omitted value, and the column was written
null: the existing value was cleared and the mutation reported success.
Single build, but the costliest single Snapback item in the farm's v7 arm
(insulin-dose-calculator-0633, Muse, 25 minutes; round-3 synthesis cluster
13), and a silent wrong write.

Ask: either an omitted optional argument compares equal to `null` (what the
author expected), or the guide states the difference between omitted and
`null` with the form that tests "was it given" — and `check` notes a write
of an optional argument to a column with no such test. Reproduce with the
build's schema before deciding (its `snapback/schema.q` is under
`~/appfarm/apps/insulin-dose-calculator-0633/` on the M5 Ultra Studio).

## Reproduction (app-farm lane S2, 2026-10-08)

**The reported semantics do not reproduce.** An omitted optional argument is
null, and `= null` is true for it, on the server and on the device, on the
build's published `0.4.13` binary and on the debug build of `d3eee62f47`:

- `snapback4 run`, and `POST /m/confirmEq` under `snapback4 dev`, with the
  build's `schema.q` plus `confirmEq` (`taken = dose if dose != null else
  d.suggested`): `{doseId}` and `{doseId, dose: null}` both answer
  `given: false` and write `confirmed: <suggested>`; `{doseId, dose: 3000}`
  writes 3000. `confirmDose` (`dose ?? d.suggested`) agrees.
- The device: `snapback4 device` over a `/sync` snapshot, `predict
  confirmEq {doseId}` predicts `confirmed: 5000, given: false`, same on
  `0.4.13`'s `device`.
- Explicit JSON `null` for `dose: int ?` is accepted. The diary's
  "expected an integer, got null" was its own issue #2: generation 1
  declared `dose: int`.

**What happened in the build**, from a copy of its dev store
(`~/appfarm/apps/insulin-dose-calculator-0633/.snapback4/store.sqlite`,
read-only): the two writes that cleared `confirmed` (commits 11 and 13)
ran under generation 2, whose `confirmDose` was
`update doses[d] { confirmed: dose }` with no null test at all. The
`dose if dose != null else …` form the diary describes was never adopted
by the dev server; generation 3 is the `??` fix. So the silent wrong
write is the documented rule "an explicit null clears an optional column"
applied to an omitted argument, which nothing in `guide writes` connected.

**Docs** (this lane): `guide writes` now says an omitted optional argument
is the same as an explicit null, that a patch `{ c: x }` therefore clears
`c` when `x` is omitted, to keep the value with `x ?? row.c`, and to take a
flag argument when clearing is meant, with a compiled `confirm(d, dose: int
?, clear: bool ?)` example under Details; `guide types` says arguments
follow the same `?` rule.

**Still open** (lead): whether omitted and null should be distinguishable
(they are already different raw arguments for write-id replay, `why
E_ID_REUSED`), and the ask for a `check` note when a mutation writes an
optional argument straight into a column with no `??` or null test.
