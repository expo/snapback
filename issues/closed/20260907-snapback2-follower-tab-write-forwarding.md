# snapback2: a follower browser tab refuses writes; forward them to the writer tab instead

**Status:** Resolved on main — 2026-09-08

**Date:** 2026-09-07 · **Area:** snapback2 client, browser carrier (LLP 1018 §3, LLP 1012 §4) · **Source:** the LLP 1018 panel's round-two objections (Gemini, Grok, Astra) and the deferred half of the second-tab policy

## What exists

Since the LLP 1018 move-one slice, a second browser tab of the same account is a
follower: it reads live, `outbox.status()` reports `reason: "follower"`, every write
refuses `E_OFFLINE_FOLLOWER` before any bytes leave, and it inherits the partition and
its queue when the writer tab closes. Followers never send plain writes because a
write landing ahead of the writer's queued intents would invert their order once the
queue is inherited.

## What is still open

The original second-tab ticket's witness — two tabs, one offline write in each,
reconnect, both settle — cannot pass under refuse-only followers. The honest completion
is command forwarding: a follower posts its intent to the writer tab (BroadcastChannel
or the Web Lock's own message channel), the writer enqueues it in the one durable
outbox and acknowledges only after durable admission, and the follower renders the
queued state from that acknowledgment. Takeover must reload committed custody before
replay so a forwarded intent is never sent twice.

Constraints: no second retained copy of the partition in the follower (the 66,000-byte
local-runtime ceiling, `rules/NOT-DOING.md`); the acknowledgment must be durable-first;
account transitions in either tab must fence forwarded intents; a frozen or throttled
writer must surface as a named readiness reason, not a silent hang.

## Regression to add when built

Two tabs, one offline write in each, reconnect; both settle in FIFO order relative to
the writer's queue; a forwarded intent replays exactly once across a writer close.

## Resolution — 2026-09-08

Durable forwarding now includes explicit uncertain-admission recovery and writer takeover. Upload and channel exclusions remain explicit capabilities.

`scripts/witness-web.mjs` drops an acknowledgment after durable admission; the real Composer preserves the draft, recovers the same request identity, and verifies one owner mutation and server row. The same executed 16/16 Chrome witness verifies cross-tab FIFO takeover. `guide/offline.md` documents these contracts.

Evidence was reconciled against main `2ac15dc2c`. LLP 1018.000 §10 completion records canonical qualification at `c20a37e22` and final package/Chrome qualification at `ab8b225e6`; unchanged native/evaluator/compiler inputs retain their earlier execution evidence. This reconciliation ran no new product tests. It closes the filed source defect; release and fresh published-package confirmation remain separately tracked.
