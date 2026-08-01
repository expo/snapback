# Diary 0042: A2 group chat and presence — improvement-sweep arm

**Application:** A2 group chat and presence (LLP 0137 contract `a2-chat-presence.v1`)
**Arm:** snapback-web, external consumer, public `@expo/snapback-*` 0.1.7 closure
**Date:** 2026-08-01
**Builder:** Claude (Fable 5), first diaried sweep arm after G1
**Capsule:** `demos/improvement-sweep/arms/a2-snapback-web/run-capsule.json`
**Result:** 11 pass / 1 explicit GAP / 0 fail / 0 Stop, expectedChecks=12 enforced

## 2026-08-01 — the arm

### Setup and posture

Clean external directory in the session scratchpad, npm-installed 0.1.7
closure (13 packages, ~8s), `snapback new chat-app --template react`, then the
frozen neutral-web shell merged in as the UI with only the chat view wired.
The shipped guide was the only Snapback documentation; twice I read installed
package bytes (recorded as assistance events, not posture breaks — they are
the product a consumer receives). Zero posture breaks: no repository source,
no LLPs for product help.

I chose **sessions mode** deliberately. Dev mode's client-asserted `userId`
would have made every negative check in this contract vacuous — Mallory could
simply claim to be Alice. This decision shaped the whole arm, mostly for the
better and once for the worse (A2-08).

### What felt easy or genuinely good

- **Install → first commit in under eight minutes.** Closure install 8s,
  scaffold + bun install ~1 minute, and the first authenticated mutation
  landed at 09:30:46Z against a server that had told me it was ready through
  a machine-readable descriptor. Nothing here needed a provider account, a
  region picker, or a dashboard.
- **Codegen as a colleague.** Every authoring mistake failed closed with a
  named diagnostic and usually a position: `page[page.length - 1]` refused as
  dynamic computed member access (line/column exact; `.at(-1)` is fine),
  `authScopeField` refusal named the table it resolved against, the
  membership rowField refusal named declaration and field. Three iterations
  to a clean 12-operation graph, none of them mysterious.
- **The membership declaration grammar.** Bootstrap-with-host-seat,
  member-issued invitations, self-accept, self-leave — the closed transition
  matrix expressed the whole channel lifecycle declaratively, and the host
  enforced it (my `inviteToChannel` handler is three lines). The uniform
  `SNAPBACK_AUTH_PERMISSION_DENIED {kind:'role'}` on read AND subscribe made
  the Mallory checks one-line assertions.
- **Revocation is a real barrier.** A2-10 is the check I'd show off: Bob's
  established private-channel live handle blanked ~1.7s after his seat was
  revoked, Alice's next message never reached him, and his fresh read got the
  same non-disclosing denial. The frozen Convex arm matched the delivery
  facts; it could not match the non-disclosure.
- **Ephemeral state is native and provably non-durable.** Typing and
  presence took one schema declaration each. A2-11 pinned the durable version
  across 20 presence publishes — zero write amplification, verified against
  the store, not asserted from docs. Convex's arm needed durable TTL rows and
  still recorded typing/presence as GAPs.
- **`_version` as commit order.** Deterministic message ordering and a stable
  pagination cursor came free from the storage model. No sequence counter, no
  hot row, no OCC contention between concurrent senders (A2-09: both
  Promise.all sends committed, observed order = version order).
- **Settlement envelopes.** `changed_count: 0` plus the original id on a
  keyed retry made idempotency machine-checkable in one line. I did not have
  to design retry evidence; the envelope already was it.
- **The 12-check suite runs in ~9 seconds** including three session mints,
  TTL expiry waits, a forced disconnect, and a destructive reset. Iteration
  speed was never the bottleneck.

### What felt hard, surprising, or bad

- **The sessions test-persona recipe is undocumented** (finding f6, the
  arm's only assistance events). The guide says "the code is read from the
  server's admin-gated mailbox" and stops. The mailbox route, its
  `x-snapback-impersonation-capability` header, the sidecar that holds the
  capability, and `createExternalSessionClient` for the bearer — all learned
  from the packaged comparator's bytes. `SNAPBACK_AUTH_IMPERSONATION_REQUIRED`
  is the rare Snapback diagnostic that does not name its carrier; the
  auth-protocol diagnostic two probes earlier had told me the exact header to
  add, which made this one feel worse than it is. Once known, the recipe is
  better than anything in the frozen evidence: ~100ms per real bearer-backed
  principal.
- **React presence is broken twice on 0.1.7.** First, every generated
  `api.ephemeral.*` reference is rejected by the prepared binding —
  `api.mjs` stamps `snapback.v0`, the binding reconstructs with the schema
  manifest's `snapback.v1`, and the canonical comparison correctly refuses
  the mismatch its own producers created (finding f2; workaround
  `binding.ephemeral.*`). Second, and worse: a provider that owns any live
  query never brings its managed presence room out of `connecting` — publisher
  `publishing` forever while remote deltas still arrive (finding f1, full
  matrix in `evidence/probes.json`). A presence-only provider works
  perfectly, which is how the UI smoke passes, but "one provider per concern"
  is not the documented model and no chat app would accept it. The headless
  overlay path multiplexes fine, so this is provider room readiness, not the
  lane. These two findings are the arm's headline: **Snapback's biggest chat
  differentiator (native presence) is currently unreachable from its own
  React arm.**
- **"Channels I belong to" is inexpressible** (finding f3). The membership
  semi-join can't bind the resource table's own `_id`, `arg()` gates a single
  known channel, and there is no non-throwing role test in a handler. I built
  a `channelSeats` app-data mirror maintained beside every membership command
  — the exact shape the scoped-roles page tells you not to build, and it's
  right to tell you that, which is why the gap needs a declaration-owned
  "my seats" projection instead.
- **No admin kick** (finding f4). The v1 private-roster posture forecloses a
  host removing a member — moderation is table stakes for chat. Self-leave
  exercised the same barrier honestly for A2-10, but the product gap is real.
- **Bounded pagination isn't in the packaged runtime** (finding f5). Diary
  0034 used `.lt/.take` on repo main; on 0.1.7 the chain passes codegen and
  dies at runtime as `undefined is not a function` inside an opaque
  `SNAPBACK_HANDLER_FAILED`. I shipped collect+sort+slice — correct, stable,
  O(channel) per page. The guide documents only `eq/in/order/collect`, so a
  consumer cannot even tell whether the absence is surface or docs.
- **The raw reset / versioned-seed collision bit me twice** (finding f7).
  The acceptance guide's `app/reset {seed}` leaves rows without versioned
  identity; the next `snapback dev` refuses with
  `SNAPBACK_SEED_NONEMPTY_UNTRACKED` — honest code, wedged loop, and the two
  recipes never mention each other.
- **Small dev-loop surprise:** `snapback dev` stops on stdin close, so
  backgrounding it with a detached shell kills it cleanly and confusingly.
  The template's spawn-with-pipe pattern is the way; worth one guide
  sentence.
- **A2-08 is the honest GAP.** Sessions-scoped history is not retainable on
  the JS arm; the handle carries the exact refusal
  (`SNAPBACK_RETENTION_NOT_RETAINABLE`, lease machinery is Contract-arm).
  I respect the fail-closed honesty — the store was durable and present, and
  the arm refused to pretend. But the product fact remains: a sessions-mode
  chat has no offline history on this arm today (owned GAP row; f8 adds A2
  evidence).

### Modeling, type flow, auth, realtime, settlement — quick verdicts

- *Modeling:* tables + membership declaration + ephemeral collections covered
  the whole contract in 105 schema lines; the one wart was the seats mirror.
- *Type flow:* the generated refs are genuinely exact — branded
  `Id<'channels'>` caught my `string` state in the UI at compile time, and
  result contracts flowed into hooks with no casts. One rough edge: the
  branded type isn't importable from the generated module path a relative
  import reaches (worked around with a structural twin).
- *Auth:* the server-derives-identity model is the best I've used at this
  scale of test; every negative check was crisp. Docs owe the persona recipe.
- *Realtime:* durable push 33-37ms, reconnect resnapshot exact, unread
  markers authoritative across two devices. The connection axis
  (`live/stale/disconnected`) rendered honestly in the shell header.
- *Settlement:* envelopes made idempotency and conflict evidence trivial;
  I never once parsed prose to learn what happened.

### Would I choose this backend for this app?

**For the backend contract: yes, enthusiastically** — with sessions mode,
membership declarations, native ephemeral state, revocation-active live
queries, and settlement envelopes, the A2 facts landed cleaner here than the
frozen evidence shows for any competitor, and the whole loop is local and
fast. **For the product including the React UI: not on 0.1.7 as shipped**,
because presence — the feature this contract exists to showcase — is
unreachable from the first-party React path (f1+f2) until two fixes land,
and a chat sidebar needs f3's projection to avoid the mirror. All three have
small, coherent fixes; none requires an architectural rethink. The
differentiators to protect while fixing: zero-durable-amplification
ephemeral state, blank-then-deny revocation, commit-order determinism, and
the settlement envelope.

### Lessons for Snapback (concrete)

1. Fix f2 (one version stamp) and f1 (room readiness on an owned socket) and
   add a packaged-closure conformance test that renders presence beside a
   live query — that single test would have caught both.
2. Ship the bounded ctx.db verbs with static chain validation; document the
   complete chain (Diary 0034 already asked; a public consumer just paid for
   it again).
3. Give the membership declaration a self-scoped seats projection.
4. Write the sessions persona recipe into the guide and teach
   `SNAPBACK_AUTH_IMPERSONATION_REQUIRED` to name its header.
5. Make the raw-reset diagnostic name its recovery.

## 2026-08-01 — RE-VERIFICATION against 0.1.8 (fix-loop entry, not a rerun)

Packages: all @expo/snapback-* at 0.1.8 (fast-path publication from
main 5d5c6b71; ledger fastpath-ledger-0.1.8-5d5c6b7183af).
Evidence: demos/improvement-sweep/arms/reverify-0.1.8/ (capsule +
evidence + drivers).

Both A2 fixes verified from external-consumer posture (fresh consumer
dir, this arm's retained app sources as fixtures):

- **a2-f1 (presence room wedged by live queries): VERIFIED.** A provider
  owning an active live-query subscription brought its managed presence
  room to status `ready` with two entries on both principals — the
  single-provider path this arm had to work around is now the working
  path (RV-A2-F1).
- **a2-f2 (api.ephemeral schemaVersion mismatch): VERIFIED.** The same
  run drove `observeSnapbackPresence` through the GENERATED
  `api.ephemeral.chatPresence` reference with no admission refusal
  (RV-A2-F2).

The packaged-closure conformance test this diary asked for (presence
beside a live query) is still worth pinning; the differentiator held.
