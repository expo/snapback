# Testing: `test`

Run `snapback2 test --port 53200` on a host assigning that port. `--port N`
binds the isolated owner there or fails with `E_OWNER_PORT_TAKEN`, without
fallback. Omit it (or use `--port 0`) for OS selection. Receipts, including
`--json`, record `owner: { pid, port }` beside `commands` after startup;
the supervisor stops and reaps that PID.

The static seed commits once before checks and journeys; omit maintained targets.

```ts
    profiles: [
      { id: "profile-alice", principal: "dev:alice", displayName: "Alice", handle: "alice_dev", avatarUrl: "https://example.com/alice.png", bio: "", location: "" },
      { id: "profile-bob", principal: "dev:bob", displayName: "Bob", handle: "bob_dev", avatarUrl: "https://example.com/bob.png", bio: "", location: "" },
    ],
```

`profile-alice` is an application id; `dev:alice` is a Principal. Seeds omit
credentials and assets (upload those). Chat leaves `charlie` without a profile
to test creation.

`fixture("fixtures/photo.jpg")` from `snapback2/test` reads bytes relative to
the authored test file, even after compilation; commit media under `tests/fixtures/`.

Write `journey(name, async ({ as, tick, effects, url }) => …)`. `test` runs six
derived check families and every headless wire journey on a fresh owner,
removes its store, and writes `.snapback/receipts/<timestamp>.json`.
Zero checks cannot pass. `snapback2 test --blocked "reason"` writes a blocked receipt.

Select: `snapback2 test --journey "todos round trip"`.
Use `--journey=--help` or `--journey=-h` for literal names. Duplicates run; selection records `scope.journey`, and skips unrelated journeys and
upper-level derived checks; embedded offline checks remain. Unknown names,
registration drift and unsuccessful runner exits fail. Five-second deadlines
and owner isolation remain. Cannot combine with `--derived-only` or `--blocked`.
`--derived-only` skips journeys and the effects witness check and records
`scope.derivedOnly: true`. Plain `snapback2 test` runs the full suite.

Journey `effects.rows({ state, after, limit })` pages the server outbox by
`(seq, id)`, up to 200 rows; pass the returned `after` until null.
`effects.settle({ upTo: sent.seq, budgetMs: 1000 })` runs a due background turn
and waits for those emissions, including `then`. Check `settled`, `rows`, and
`remaining`: backoff (with `nextAt`), then_pending, running, engine:none, budget.
`tick(ms)` advances retry eligibility. Results over 16 KiB carry `resultCapped`;
`guide effects` defines receipts and limits. Without an engine, `effects.settle`
still pumps a pending `then` and waits out a backoff that would land inside its
budget; it returns at once only when nothing ≤ `upTo` can move. The run is
`blocked: effects:no-engine`, even if the journey throws on unsettled work;
after `effects.settle` a queued row cannot pass. The derived effects check also
remains `blocked: no engine in this build`, with `detail.build`.

`effects.provider(origin, handler)` starts a loopback stand-in for this
journey; bind before emitting. A row claimed between emit and bind fails
`E_EFFECT_UNBOUND`. The handler's `Request` URL and `Host`, and the effect's
`response.url` (including redirects), stay logical. The supervisor closes the
epoch on every exit, waiting for its in-flight claims for at most the effect
budget + 1 s. A still-running row fails the journey before another epoch opens.
Close returns at once with no outstanding claims; a journey with no provider
needs no cleanup acknowledgment.
Opening an epoch keeps the ordinary five-second control timeout.
Malformed bindings and stale epochs return `E_INPUT` with the control route
as the site; bind through `effects.provider` in the current journey.
`provider.requests` captures method, path, headers and UTF-8 body text: at most
200 requests and 16 KiB per body, cut at a character boundary. `bodyBytes`
reports original bytes; `bodyCapped: { bytes, limit }` reports truncation;
`dropped` counts requests beyond the cap.

With an engine, each declared effect needs one journey emission whose row is
`sent` and whose declared `then` committed. An effect with grants also needs
at least one request the bound transport substituted in that attempt, recorded
as `provider: { origins, requests, refused }` on its transition. Returning
without fetching proves no provider contact. A caught unbound/grant refusal
proves nothing, even after a substituted hop: that attempt is negative evidence
and cannot witness. An effect with no grants records `provider: { declared: false }`;
no `then` records `then: { declared: false }`. The witness receipt lists
`{ journey, id, seq, attempts, state, ms, provider, then }`. Timing matches the
outbox id and attempt; unavailable timing is `ms: null, timing: "unavailable"`.
Negative evidence is `notWitnessed[effect]: { rows, dropped }`: terminal rows that
are not witnesses, capped at 20 rows, with `lastError` and `provider` evidence.
Missing witnesses block `effects:no-witness`, naming the effect and journey
needed. Unavailable trace history blocks `effects:history-unavailable` with its
reason in `detail.history`, instead of asking for another witness. Malformed
history or a control-client failure fails the check. A selected journey run
skips the check with `scope.journey`.
`E_OWNER_TEST_IO` names the failed supervisor control route; rerun `snapback2 test`.

Projects with scoped memberships also run the canonical `live-revocation`,
`successor-policy-fence`, and `grant-incarnation-aba` authorization proofs.
They prove revocation delivery, active-generation policy, and immutable grant
incarnation through the served loop. Projected policy probes require IR-proved carrier
fields plus complete protected rows; mixed scalar/array/nested projections block.
Guards admit only literals, arguments, viewer and self-readable membership
existence with stable keys, independent of the denied table. Unproved control
flow, including merges in expressions, blocks; `detail.candidates` explains each rejection.

Canonical proof carriers:

- `memberAdd(conversationId: conversations, principal: principal)`
- `memberPromote(conversationId: conversations, membershipId: memberships)`
- `memberRemove(conversationId: conversations, membershipId: memberships)`
- `memberLeave(conversationId: conversations, membershipId: memberships)`

Add returns its id; the others bind that exact incarnation. Scope-only leave
is unsafe because delayed replay could delete a successor seat. Seed a member,
second same-scope admin, spare nonmember, and room below the cap.
Journeys share the owner; isolate disposable writes from later inboxes and await
client closes.

Use a small seed. Rules compare every stored row for every seed persona within
16,384 probes; oversized tables block with counts and a smaller-seed rewrite.
Empty generated logs/receipts block too: seed content in a group with recipients.
Invalidation witnesses certificate-intersection groups and possible
concrete-disjoint silence. Whole-index queries whose every mutation write must
overlap report silence inapplicable; do not invent an unrelated operation.
The receipt names groups and physical attempts. SSE silence ends at a fresh
subscription frame after the write on the same ordered stream. Mutation
search uses the first two scopes and six personas; no committing witness blocks.
Replay covers every generic mutation independently. Author journeys for larger
scenarios and operation-specific behavior; put useful admitted and excluded
personas and scopes near the seed's start.

`dev --stop` halts new effect claims and joins for budget + 1 s. A surviving
thread logs `outbox.engine: detached` with running ids, not proof of stopping;
next boot marks those rows `sent_unknown`.

`reset` reports seed row/persona counts; `reset --empty` stays empty across
restart. Both preserve sessions (`guide operator`).
