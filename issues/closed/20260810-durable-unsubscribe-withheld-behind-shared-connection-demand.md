# durable unsubscribe is withheld while another lane holds connection demand

**Status:** Closed
**Opened:** 2026-08-10 · **Resolved:** 2026-08-10 · **Severity:** P2 · **Area:** Client kit · realtime · Contract adapter
**Related:** LLP 0034 §10.11, LLP 0013, LLP 0090, `demos/pointing-room`

## Problem

When a durable live-query subscription and an ephemeral collection share one
`connectionId`, disposing the durable subscription does **not** unregister it
server-side. The registration survives indefinitely — not late, never.

Found while landing the keyed-surface ephemeral link family. The keyed Contract
surface briefly built its ephemeral wiring on the same connection as its durable
keyed queries. The pointing-room contract-browser acceptance then failed at the
room switch: after re-keying `liveRound`/`liveTally` from Planning to Platform,
`admin.inspect()` reported **four** live subscriptions (both predecessors plus
both successors) instead of two. Raising the wait from 10 s to 45 s did not
change the result.

The UI half was correct throughout — predecessor bindings were disposed, the
Planning tally cleared, the Platform empty state rendered. Only the server-side
registration outlived the binding.

## Evidence

All arms ran on the same host, same Rust binary, same `node_modules`; only the
adapter JS differed (MacBook Air, 2026-08-10, against commit 61bed5550):

| arm | composition | result |
| --- | --- | --- |
| parent adapter, two surfaces (separate connections) | — | PASS |
| landed adapter, either demo boot | shared connection | FAIL, 4 subscriptions |
| landed adapter, 45 s wait | shared connection | FAIL, 4 subscriptions |
| landed adapter, durable links unwrapped | shared connection | FAIL |
| landed adapter, no `ephemerals` on the provider | shared connection | FAIL |
| landed adapter, ephemeral machinery stubbed out entirely | no ephemeral lane | PASS |
| landed adapter, ephemeral lane on its own connection | separate connections | PASS (both boots) |

The bisect isolates it to the *existence of an ephemeral consumer on the durable
connection*, not to the provider's `subscribeEphemeral`, not to the link
wrappers, and not to the authority-participant rewrite.

## Why it matters beyond the adapter

The keyed Contract surface now gives its ephemeral lane a separate connection
(`packages/snapback-contract/index.mjs`, keyed branch), so no shipped surface
depends on the answer. But the underlying rule is unclear and probably wrong:
an application composing a durable subscription and an ephemeral room on one
connection through the kit directly would hit this, and the leak is unbounded —
one stale server registration per re-key, for the life of the connection.

The multi-live surface deliberately shares one `connectionId` across both lanes
and does not show the failure, which is consistent with it never re-keying a
durable subscription; that is an absence of exercise, not evidence of safety.

## Desired resolution

- Decide the intended rule: is a durable unsubscribe supposed to be delivered
  independently of other consumers' demand on the same connection? If yes this
  is a kit defect; if no, the constraint needs to be stated where composers can
  find it.
- Add a host-independent regression gate at the wire/registration level —
  "a disposed keyed binding's subscription is actually unregistered" — so this
  class cannot depend on a demo browser arm running on a host with working
  Chrome. A sibling session's axis parity harness is the natural home.
- Once the kit rule is settled, revisit whether the keyed surface should go back
  to one shared connection.

## Resolution

LLP 0189 D-8's host-independent axis harness now covers the two connection
topologies at the raw frame and `admin.inspect()` registration boundary. The
isolated keyed durable registration disappears on binding disposal. With an
ephemeral consumer holding the same `connectionId`, disposal emits no durable
unsubscribe request, the registration remains present, and it receives the
next commit's `authorization_invalidation` frame. Releasing the final ephemeral
demand closes the owned socket and reaps the retained registration.

The empirical verdict is therefore a composition constraint, not an unresolved
adapter workaround: an independently re-keyed or disposed durable subscription
must not share its connection id with an ephemeral demand holder. LLP 0034
§10.11 now states that rule. The keyed Contract surface keeps separate durable
and ephemeral connection ids; it must not return to one connection under the
current lifecycle contract.

Evidence: `tests/acceptance/axis-parity-harness.mjs`, registered as the
complete-battery-only `axis-parity-harness` run in
`scripts/verify-local-proof`. The confirming run reported `PASS axis parity
harness — 8/8`.
