# Migrate the Clique kit quoted excerpt to the unambiguous preview selector

**Filed:** 2026-08-17 · **Status:** Open · **Systems:** Benchmarks, Clique UI
kit, Choreography

**Related:** LLP 0201; LLP 0266; the Coterie `0.3.1-m8` compatibility landing
in `benchmarks/tools/social-messenger/choreography/choreography.mjs`

## Problem

The frozen Clique kit's `QuotedReply` excerpt defaults to
`sm-convo-quote`, while the amended contract assigns that ID to the
per-message Reply action and assigns `sm-convo-quote-preview` to the pressable
quoted excerpt. The `0.3.0-m8` choreography exposed the contradiction directly:
old `choreography.mjs` lines 1384 and 1391 both pressed `sm-convo-quote`, first
to start a reply and then to jump from the quoted bubble to its source.

The Coterie `0.3.1-m8` landing makes the jump prefer
`sm-convo-quote-preview`, but LLP 0266 D2 forbids changing the frozen Clique
surface as part of Coterie work. The harness therefore retains a deterministic,
reply-bubble-scoped fallback to `sm-convo-quote` for `0.3.0`-era clients until
the kit can migrate under its own version.

## Closure wanted

Before the P3 freeze, change `QuotedReply`'s default excerpt test ID to
`sm-convo-quote-preview`, bump the Clique kit version, update its tests and
versioning documentation, and rerun the affected M3 choreography proof against
the migrated kit. Then remove the legacy `sm-convo-quote` jump fallback from
the choreography so that ID once again has only its per-message Reply-action
meaning when the instrument freezes.

## Resolution (2026-08-17)

Closed by the migration landing on this ticket's closure list, in order:

1. `QuotedReply` default excerpt test ID → `sm-convo-quote-preview`
   (`benchmarks/tools/social-messenger/ui/src/QuotedReply.tsx`).
2. Kit version `0.3.0-m8` → `0.3.1-m8` (VERSION, package.json, README,
   screens.md); kit test pins the destructured-parameter default, the
   documented default, and the absence of the legacy ID.
3. Choreography legacy reply-bubble-scoped `sm-convo-quote` jump fallback
   removed; `sm-convo-quote-preview` is the sole jump path and
   `sm-convo-quote` keeps only its per-message Reply-action meaning.
   Because that changes the `quoted-reply-excerpt-and-jump` assertion
   semantics under an already-issued version, the choreography bumped to
   `0.3.2-m8` (emitter, schema consts + $id, VERSION, package.json,
   receipts-format, README history); a `0.3.2-m8` receipt proves
   preview-only selection.
4. M3 choreography proof RERUN against the migrated kit (host-side,
   2026-08-17, runId d146fb5f-3d0a-4456-a63a-0feec5573c92):
   segment-summary `green: true`, `nonGreenCause: null`;
   `quoted-reply-excerpt-and-jump` passed 3/3 attempts with note
   "quoted-excerpt jump selector: sm-convo-quote-preview"; lane
   acceptance (P2-pilot convex lane) m3 PASS 10/10 feeding
   `suite.pass: true`.

Proof-harness notes recorded honestly: the pilot lane's acceptance scratch
copy needed the same one-selector migration (its jump test still pressed
`sm-convo-quote` on the excerpt) — the persistent copy at
`/Users/ccheever/clique-runs/p2-pilot/convex-lane/acceptance/m3.mjs:196`
still carries the pre-amendment selector and should migrate with the pilot;
and the pilot's `suite-status.json` carries an `m7` segment the m3
choreography rejects, filtered for this run. Coterie's
choreography-source expectations (`tests/feed-behavior.test.ts`) were
reconciled in the same landing (37/37 green).
