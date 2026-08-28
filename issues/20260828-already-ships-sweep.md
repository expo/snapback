# Already-ships sweep of the LLP 0317 backlog — 46/46 rows verdicted

**Status:** Closed (survey complete; outcomes routed below)
**Opened:** 2026-08-28
**Systems:** Guide, Diagnostics, Codegen, Benchmarks, Agent experience
**Related:** LLP 0317, LLP 0317.000, LLP 0193, LLP 0252, LLP 0180

## Why this ran

Of the first eight LLP 0317 backlog rows anyone verified against the code,
**five already shipped**. O10 asked to refuse dynamic `take` — but
`take(limit: number)` is the declared type and the guide recipe uses
`.take(args.limit)`. O12 asked to type `ctx.refuse` as `never` — it already is,
in the exact published version the lanes ran. O34 asked for a membership
authorization primitive — it ships on all three surfaces. O42 asked for a
headless Node page — `guide/clients/headless.md` is 49 KB. O23 asked to surface
result budgets — `guide/backend/mutations.md:312` states the ceiling and the
diagnostic names which bound failed.

Implementing those as written would have produced no-ops, and O10's would have
deleted a working, documented API. So the remaining 38 rows were swept before
anyone built against them.

## Method

Four read-only codex `gpt-5.6-sol` @ xhigh lanes, one per subsystem batch,
partitioned so every row was assigned exactly once. The burden of proof was
deliberately **asymmetric**: `ALREADY-SHIPS` needed only a path and spelling,
while `GENUINELY-OPEN` had to say *where the lane looked and what it found
instead* — because "I searched and found nothing" is precisely the failure mode
being audited. The seven `GENUINELY-OPEN` rows were then cross-checked by
`grok-4.6` @ xhigh, instructed to falsify rather than confirm, since a wrong
"open" is the expensive error: those are the rows that get built.

Per-batch reports are in `issues/sweep-20260828/`.

## Result

| Verdict | Count | Rows |
|---|---|---|
| **ALREADY-SHIPS** | 9 | O11, O16, O18, O23, O30, O34, O36, O39, O42 |
| **ALREADY-SHIPS (repair ships; observed failure unexplained)** | 2 | O10, O12 |
| **PARTIALLY-SHIPS** | 19 | O1, O2, O3, O4, O9, O13, O15, O17, O19, O20, O22, O24, O25, O27, O28, O37, O40, O41, O44 |
| **GENUINELY-OPEN** | 7 | O8, O26, O31, O32, O38, O43, O45 |
| **NEEDS-REPRO** | 7 | O5, O6, O7, O14, O21, O33, O46 |
| **CONFIRMED DEFECT** | 1 | O29 |
| **NOT REPRODUCIBLE** | 1 | O35 |

**Only 7 of 46 rows are genuinely new capability work.** Eleven already ship,
nineteen are partial — routing and documentation deltas rather than builds —
and seven cannot be sized until a reproduction settles whether the behaviour
they describe exists at all.

## What this changes

LLP 0317.000 sized Wave 3 ("Prevention") as the bulk of the program, with six
implementation lanes. Most of that work is now **routing** work: the capability
exists and cannot be found. That is the same conclusion the retrieval rows
reached from the other direction, and it makes O44 the program's load-bearing
row rather than one item among forty-six.

The nineteen `PARTIALLY-SHIPS` rows each shrank to a named delta. They should be
re-scoped against their batch report before any is scheduled; several are one
sentence, not a feature.

## Cross-check refinements on the seven open rows

grok confirmed all seven as open and corrected three framings:

- **O31 (no Familiar template)** — **LLP 0252 Phase 3 already plans paired
  Familiar templates.** This is unshipped planned work, not an unrecognised
  gap. LLP 0317.000's L9b must reference LLP 0252 rather than commission fresh
  work, or it will duplicate a plan of record.
- **O38 (`babel.config.js` under `"type": "module"`)** — the mechanism as
  written is wrong. The scaffold never emits `babel.config.js`; the lanes added
  it during ordinary Expo Router conversion and then renamed it `.cjs`. The
  prevention gap (emit `.cjs`, map the Metro `ReferenceError` to a cause) is
  real; the "the scaffold produced a broken transformer config" framing is not.
- **O32 (guide is Explicit-shaped)** — not literally "Explicit examples only":
  `guide/backend/assets.md` already transcludes a Familiar `defineAssetUpload`
  fixture and `guide/auth/scoped-roles.md` points at a Familiar witness. What
  is missing is the **corpus policy**, which is what L9a was chartered to
  record.

It also narrowed **O26**: current source does register `MediaCollectionV1` on
the local SQLite target, so the gap is specifically the absent
codegen-required-vs-every-platform comparison in publication qualification, not
the capability.

## A correction worth recording

The supervisor's own spot check of **O16** concluded "genuinely open — no early
churn warning, only the cap in the engine," having grepped
`crates/snapback-engine` and `guide/`. That was wrong.
`SNAPBACK_REACT_SUBSCRIPTION_CHURN` fires after eight descriptor transitions in
two seconds, and `SNAPBACK_REACT_SUBSCRIPTION_VIEW_BUDGET_EXCEEDED` carries
`owner`, `count`, `budget: 16`, and `hardCeiling: 64`, with a test proving the
warning arrives before the refusal — all in `packages/snapback-react/`, which
the spot check never looked in.

O16's candidate intervention was "diagnose churning subscription identity with
current/limit counts before the cap." That ships, as specified. The check
searched one place, missed, and concluded absent — the exact error this sweep
exists to catch, committed while running it. Recorded because it is the best
available evidence that the asymmetric burden of proof is the right rule.

## Routing

- The 11 already-ships rows close in LLP 0317 with their spelling recorded, and
  their *findability* becomes O44 work.
- The 19 partial rows keep their row but carry the batch report's named delta.
- The 7 open rows are the real Wave 3/4 backlog. O31 routes to LLP 0252.
- The 7 needs-repro rows stay gated in LLP 0317.000 Wave 1, unchanged.
