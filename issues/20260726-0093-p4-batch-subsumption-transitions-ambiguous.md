# 0093 P-4 spec defect: the batch-subsumption rule is self-contradictory on transitions

**Opened:** 2026-07-26
**Source:** LLP 0093 D4 clean-room discipline (P-4 Dart client build).
**Systems:** Wire Protocol, Client SDK, Tests

## The defect

LLP 0095 §2.1's judgment rules were pinned specifically so "two independent
harnesses could [not] pass the same corpus under different judgments". Rules
1–3 still admit two incompatible harnesses for
`poll.acknowledged_batch.malformed_item_forces_resync`.

- **Rule 1** — actions are an exact, unordered set. Silent about transitions,
  though the fixture asserts them.
- **Rule 2** — in a batch containing an undecodable item, "the per-item
  **actions** of the remaining items (their `unwrap_durable` and
  **version-guard outcomes**) are subsumed under the single
  `deliver_batch_remainder` action". Only actions are named.
- **Rule 3** — `given.connection: {"state": "attached"}` is evaluated
  against two durable subscriptions in `LIVE`, "**ids arbitrary**".

The fixture's `batchContext` item is a valid `live_replace` for
`sub_fixture_1` at version 41, and its `expect.transitions` lists **only**
the connection-wide transition.

Now: rule 2's own parenthetical says the remainder items have "version-guard
outcomes" to subsume — which is only true if `sub_fixture_1` is *in* the
evaluated population. But rule 3 says ids are arbitrary. So:

| Harness | Pinned ids | Transitions subsumed? | Verdict |
| --- | --- | --- | --- |
| A | include `sub_fixture_1` | yes | PASS |
| B | include `sub_fixture_1` | no (rule 2 says *actions*) | **FAIL** — emits an extra `{subscription: sub_fixture_1, to: live, version: 41}` |
| C | arbitrary, not `sub_fixture_1` | either | PASS, but vacuously — nothing was delivered, so "deliver the remainder" is untested |

Harness B is the literal reading of rule 2 and it fails a fixture the spec
declares normative. Harness C passes while proving nothing, which defeats
the fixture's stated purpose ("must never abort the remainder of the
acknowledged batch").

## Cost

~25 minutes of reading and re-reading before writing a line of the harness,
and the ambiguity is only resolvable by reasoning about which reading makes
the fixture satisfiable at all — not by reading the spec.

## Resolution taken in the Dart client

Subsumption covers **both** actions and transitions (the only self-consistent
reading), and the pinned population deliberately includes `sub_fixture_1`
so the remainder is genuinely applied rather than vacuously skipped
(`clients/dart/lib/src/fixtures.dart`, `pinnedAttachedPopulation`).

## Fix wanted

Either:

- **(a)** amend rule 2 to say per-item **effects** (actions *and*
  transitions) are subsumed, and amend rule 3 to pin the ids concretely
  rather than "arbitrary" — the arbitrariness is what makes the fixture's
  coverage unknowable; or
- **(b)** give batch fixtures an explicit `given.subscriptions` (the
  `formatVersion` bump §2.1 already anticipates) so the population is data,
  not a spec rule, and state the transition treatment in the fixture itself.

(b) is preferable: it removes the interaction between two prose rules
entirely.
