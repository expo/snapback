# Terminal accounting: do Ask/push/capability settlements need a caller fence? (ruling packet)

Status: Ruled 2026-08-22 — retirement blocks new handoffs; durable predecessors
own completion and settlement
Created: 2026-08-21
Related: issues/20260821-authorized-effect-remedy-classification.md,
issues/20260821-durable-authority-to-effect-handoff-design.md, LLP 0204

## Author ruling — 2026-08-22

Retirement blocks new handoffs only. Once an exact durable predecessor owns
the effect, it also owns completion and settlement; retirement does not
retroactively veto it. The question below is retained as the decision record.

When a live caller authorizes a durable handoff and then logs out or is revoked, does retirement:

1. **Block only new handoffs**, while the durable predecessor owns completion and settlement
   — *recommended*; or
2. **Retroactively veto settlement**, accepting stranded Ask reservations, downgraded push truth,
   and stale capability telemetry?

That is the whole ruling. Everything below is the evidence for it.

## Do not rule on all three together

The classification grouped these as one "terminal accounting" category. They do not share a
structural situation, and a single ruling would copy the wrong precedent into two of them.

| Settlement | Recommended ownership | Already structural? |
|---|---|---|
| Push | Durable push intent + exact transmitting claim | **Yes** — already correct |
| Capability use | Atomic consumed-use ordinal | **Yes for authorization** — already correct |
| Ask spend | Durable run/turn authority | **No** — current ledger is aggregate and cannot authorize a request |

## Push — already correct, very high confidence, nothing to do

There is a real structural handoff: reservation commits the normalized intent (payload, resolved
audience, batches, messages), each batch takes an exact claim, and `claimed → transmitting`
verifies batch/claim ID/fence/lease and commits **before the first provider byte**. Settlement
then verifies the exact claim is still the active transmitting claim before writing.

Suppressing settlement after logout cannot cause a double-send — the batch goes `ambiguous` on
claim expiry and never auto-resends — but it permanently destroys precision: an Expo ticket can
only be recorded as ambiguous, receipt polling never starts because the ticket ID was discarded,
and redrive then requires an explicit duplicate-risk acknowledgement.

Not suppressing it grants an attacker nothing: settlement is bound to the existing claim and can
mutate only that batch. It cannot select a destination, payload, or token.

## Capability use — already correct, high confidence

The public link bearer *is* the credential; the route installs no caller session authority, and
LLP 0204 says the minting session's liveness does not govern link life. Authority is consumed
atomically at consumption — active/unexpired/unexhausted check, live minter, decrement, use-count
increment — **before** the function is invoked. Settlement afterwards consumes nothing.

Separate clarification, not a fence question: is `last_outcome` intentionally best-effort
latest-use telemetry? If exact per-use truth is wanted, that is a storage-model gap, not a reason
to attach settlement to a live session or a revoked bearer.

## Ask — the policy is right but the structure is missing

The ledger is aggregate day/lane/caller counters; the returned reservation is an in-memory value,
not a durable request identity. There is no single "provider accepted" cut: an Ask run may make
several provider turns, may settle zero usage before any provider call, and settles only after the
loop returns.

Fencing this write would be **actively harmful**. The current loop has no durable per-turn
handoff, so provider turns can already continue after logout. Live-fencing the final accounting
write would not stop those calls — it would only hide their outcome and strand the reservation.

Suppression is safe in the conservative direction (enforcement counts `spent + reserved`, so no
overspend) but can strand up to a full per-request maximum in the principal-day, integration-day
and app-month lanes, self-healing only when the day or month rolls over.

The fix is the durable run/turn structure the handoff design already calls for, not a session
fence.

### Possible budget-evasion vector, worth its own look

After transport uncertainty, settlement may release budget for provider usage that **actually
happened**: `execute_ask_loop` returns only tokens accumulated from earlier successful turns, and
final settlement releases the remainder using that incomplete total. Whether a caller can reliably
induce that server-to-provider failure window is marked INFERRED. A fake provider that reads the
request and then drops the connection before responding would confirm or refute it.

## Regressions that would make the ruling load-bearing

Push: retirement before reservation → no durable intent, zero Expo calls; reservation/transmitting
wins, then logout or revocation commits, fake Expo returns tickets, settlement succeeds from the
claim; assert exact ticket, receipt schedule, message state, and provider-driven token retirement;
then suppress after transmitting, advance past the claim lease, and assert exactly `ambiguous` with
no automatic resend.

Capability: revocation before consume → no invocation, no decrement; consume wins, revoke while
the function is paused, allow that invocation to finish, and assert settlement leaves status
revoked and uses decremented; race two allowed uses settling out of order.

Note: the existing tests prove only that global-mode retirement refuses these settlements and that
the mode guard spans the commit. They do **not** prove logout/revocation-after-handoff semantics,
which is exactly the property being ruled on.

## Provenance

Read-only codex analysis against `287630a3e`. Full packet with file:line citations appended below.

---

# Decision packet

Read-only analysis against checkout `287630a3e3e3ff078803e67601ca2aae12bc3ed4`. No files were modified.

## Recommendation

Do not issue one undifferentiated ruling for all three.

| Settlement | Recommended ownership | Already structural? |
|---|---|---|
| Ask spend | Durable Ask reservation/run/turn authority; no live-session veto after the relevant handoff | **No.** Current reservation is aggregate and process-local |
| Push | Durable push intent + exact transmitting claim | **Yes**, for settlement |
| Capability use | Atomic consumed-use ordinal, with settlement treated as best-effort aggregate telemetry | **Yes for authorization**, but there is no durable per-use outcome record |

The durable-handoff rule gives the right general answer: retirement before handoff prevents the effect; retirement after handoff prevents new work but does not veto truthful settlement ([handoff design:18](issues/20260821-durable-authority-to-effect-handoff-design.md:18), [handoff design:34](issues/20260821-durable-authority-to-effect-handoff-design.md:34)). But that design is still Proposed ([handoff design:3](issues/20260821-durable-authority-to-effect-handoff-design.md:3)).

The current `effect_guard` spelling is explicitly mode-only: it checks the admission epoch but does not reserve session or service publication authority ([invocation.rs:1765](crates/snapback-sync/src/auth/invocation.rs:1765), [invocation.rs:1777](crates/snapback-sync/src/auth/invocation.rs:1777)). Therefore the policy should be made structural by changing what authorizes settlement, not by switching these writes to the caller’s split-phase session fence.

## 1. Ask spend settlement

### Irreversible cut

There is no single “provider accepted” cut shared by every Ask settlement:

- Every path first commits the budget reservation, before streaming setup or provider execution ([server.rs:25245](crates/snapback-server/src/server.rs:25245)).
- If stream setup fails or no stream initiator exists, the server settles zero usage before any provider call ([server.rs:25258](crates/snapback-server/src/server.rs:25258), [server.rs:25269](crates/snapback-server/src/server.rs:25269)).
- The normal path can make several provider turns; each turn calls `chat_completion` inside the loop ([server.rs:24785](crates/snapback-server/src/server.rs:24785), [server.rs:24814](crates/snapback-server/src/server.rs:24814)).
- The physical provider cut is `send_json` ([ask.rs:318](crates/snapback-engine/src/ask.rs:318)). A successful turn has received and parsed a provider response. A transport error does not prove whether the provider accepted the request ([ask.rs:324](crates/snapback-engine/src/ask.rs:324)).
- Final settlement happens only after the Ask loop returns ([server.rs:25281](crates/snapback-server/src/server.rs:25281), [server.rs:25298](crates/snapback-server/src/server.rs:25298)).

Thus the only universally definitive predecessor is the durable maximum-budget reservation. Provider work may be completed, absent, or ambiguous.

### What the write records

The table has only aggregate day/lane/caller counters: reserved and spent tokens/result bytes ([ask_spend.rs:25](crates/snapback-kernel/src/storage/ask_spend.rs:25)). The returned reservation is an in-memory value containing day, month, subject, and maxima—not a durable request identity ([ask_spend.rs:46](crates/snapback-kernel/src/storage/ask_spend.rs:46)).

Settlement atomically subtracts the entire maximum reservation and adds the supplied actual usage across principal, app, and optional integration rows ([ask_spend.rs:332](crates/snapback-kernel/src/storage/ask_spend.rs:332), [ask_spend.rs:343](crates/snapback-kernel/src/storage/ask_spend.rs:343)). It records caller-attributed accounting—the subject is derived from user or integration identity ([server.rs:24621](crates/snapback-server/src/server.rs:24621))—but no content, grant, provider receipt, request digest, or execution authority.

It is not always a truthful provider outcome. If a provider turn ends in transport uncertainty, `execute_ask_loop` returns only tokens accumulated from earlier successful turns ([server.rs:24824](crates/snapback-server/src/server.rs:24824)); final settlement then releases the remaining reservation using that incomplete total ([server.rs:25291](crates/snapback-server/src/server.rs:25291)). The handoff design correctly calls the current ledger insufficient and requires conservative reservation retention for an ambiguous turn ([handoff design:280](issues/20260821-durable-authority-to-effect-handoff-design.md:280), [handoff design:297](issues/20260821-durable-authority-to-effect-handoff-design.md:297)).

### If settlement is suppressed after logout

The outstanding maximum reservation remains. That behavior is already demonstrated by the global-mode retirement test ([admission_fence_tests.rs:1164](crates/snapback-engine/src/local/admission_fence_tests.rs:1164), [admission_fence_tests.rs:1176](crates/snapback-engine/src/local/admission_fence_tests.rs:1176)).

Consequences:

- It cannot permit overspend: enforcement uses `spent + reserved` ([ask_spend.rs:191](crates/snapback-kernel/src/storage/ask_spend.rs:191)).
- It can strand up to a full per-request maximum in the principal-day, integration-day, and app-month lanes.
- A retry makes a new reservation if capacity remains; otherwise it is refused. It does not automatically repair the old one.
- Capacity self-heals only when the relevant day/month changes ([ask_spend.rs:400](crates/snapback-kernel/src/storage/ask_spend.rs:400)). The old historical counters remain inaccurate.

So suppression is safe in the conservative direction, but can deny legitimate capacity for as long as a month.

### If settlement is not suppressed

For a known result, settlement cannot consume additional budget. It requires `actual <= reserved` ([ask_spend.rs:338](crates/snapback-kernel/src/storage/ask_spend.rs:338)); because enforcement previously counted the whole reservation, settlement only preserves or releases capacity. It grants nothing and initiates no provider call.

The real stale-authority risk is earlier: the current loop has no durable per-turn handoff, so later provider turns may continue after logout. Live-fencing the final accounting write would not stop those calls; it would merely hide their outcome and strand the reservation.

A separate downside exists today: after transport uncertainty, settlement may release budget for provider usage that actually happened. **INFERRED:** a malicious caller may or may not be able to induce that server-to-provider failure window reliably. A fake provider that reads the request and drops the connection before responding would confirm the accounting defect deterministically.

### Third option / handoff rule

Yes, but it is not implemented structurally yet.

The proposed design requires a durable Ask run and per-provider-turn `transmitting` record, then says spend settlement must derive from those records ([handoff design:286](issues/20260821-durable-authority-to-effect-handoff-design.md:286), [handoff design:444](issues/20260821-durable-authority-to-effect-handoff-design.md:444)). The current aggregate reservation cannot serve as the exact provider-effect authority.

### Verdict

**Record-authorized, mode-only settlement; confidence high. Not “already correct/no work.”**

Do not require the caller session to remain live after provider work. Instead, require a unique durable Ask reservation/run/turn proof, and make settlement consume that proof without accepting the original caller-shaped `PreparedAuthority`.

### Load-bearing regression

For the recommended ruling:

1. Pause before the per-turn handoff; logout wins; assert no provider request occurs.
2. Let the turn handoff commit; pause; complete logout; release the provider; assert exactly one provider call and successful settlement from the durable turn token.
3. Drop the process after `transmitting`; assert the turn becomes ambiguous and its conservative budget remains reserved.
4. Fake “request read, connection dropped”; assert settlement does not release unknown usage.
5. Prove a settlement token is single-use and bound to the exact run/turn/reservation.

If the author instead chooses caller-live settlement, the defining regression should logout after provider response but before settlement, require refusal, and assert the full reservation remains charged through the period. That test would make the deliberately stranded state explicit.

## 2. Push settlement

### Irreversible cut

Push has a real structural handoff:

- Reservation commits the normalized intent before provider work ([engine.rs:6883](crates/snapback-engine/src/local/engine.rs:6883)); its storage contract binds payload, resolved audience, batches, and messages ([push.rs:1302](crates/snapback-kernel/src/push.rs:1302)).
- Each batch receives an exact claim before transmission ([server.rs:2136](crates/snapback-server/src/server.rs:2136)).
- `claimed → transmitting` verifies batch, claim ID, fence, and unexpired lease and commits before the first provider byte ([push.rs:1769](crates/snapback-kernel/src/push.rs:1769), [push.rs:1780](crates/snapback-kernel/src/push.rs:1780)).
- Only then is the Expo payload submitted ([server.rs:2159](crates/snapback-server/src/server.rs:2159), [server.rs:2170](crates/snapback-server/src/server.rs:2170)).
- Settlement follows after the provider call returns ([server.rs:2178](crates/snapback-server/src/server.rs:2178)).

For a parsed HTTP 200 ticket response, Expo has definitively returned per-message ticket outcomes ([push.rs:126](crates/snapback-services/src/push.rs:126)). For transport or response-read failure, delivery is ambiguous ([push.rs:72](crates/snapback-services/src/push.rs:72))—but the durable transmitting cut is still definitive.

### What the write records

Settlement accepts a closed outcome vocabulary: tickets, permanent/config/retryable failure, or ambiguity ([push.rs:193](crates/snapback-kernel/src/push.rs:193)). It first verifies that the exact claim remains the active transmitting claim ([push.rs:1808](crates/snapback-kernel/src/push.rs:1808)).

It records more than a single status:

- batch and intent terminal state;
- ticket IDs and receipt-poll deadlines;
- per-message handed-to-Expo/failure state;
- removal of retained token bytes;
- `last_successful_handoff_at_ms`;
- provider-driven token retirement for `DeviceNotRegistered` ([push.rs:1857](crates/snapback-kernel/src/push.rs:1857), [push.rs:1896](crates/snapback-kernel/src/push.rs:1896)).

Those are durable lifecycle consequences, not new grants or caller-owned application data. The token-retirement consequence outlives the settlement, but it is derived from the provider outcome and exact claimed token.

### If settlement is suppressed after logout

The batch remains `transmitting` until its 30-second claim expires ([push.rs:19](crates/snapback-kernel/src/push.rs:19)). Maintenance then converts it and its messages to `ambiguous`; it never automatically resends ([push.rs:2170](crates/snapback-kernel/src/push.rs:2170)). Maintenance runs that recovery before claiming further work ([push_registry.rs:155](crates/snapback-kernel/src/storage/push_registry.rs:155)).

Therefore suppression is detectable and eventually terminal, but permanently loses known precision:

- an Expo ticket can be recorded only as ambiguous;
- receipt polling never starts because the ticket ID was discarded;
- a known provider failure becomes ambiguous;
- redrive requires an explicit duplicate-risk acknowledgement.

It does not silently auto-double-send, but the ledger can never recover the exact provider response.

### If settlement is not suppressed

Settlement cannot send another notification. It is bound to the existing transmitting claim and mutates only its batch/messages/intent. An attacker whose logout occurs after the accepted handoff gains no new destination, payload, message, or authority.

The only potentially adverse side effect is provider-driven token retirement, but the provider outcome and exact claimed token determine it; the retired caller cannot select an arbitrary token at settlement.

There is a separate upstream defect: immediate reservation still uses only the old mode guard, and the service-authority check remains immediately before transmitting ([engine.rs:6927](crates/snapback-engine/src/local/engine.rs:6927), [server.rs:2144](crates/snapback-server/src/server.rs:2144)). The handoff design already calls for correcting that boundary ([handoff design:224](issues/20260821-durable-authority-to-effect-handoff-design.md:224)). It does not make settlement caller-owned.

### Third option / handoff rule

This third option already exists: reservation + exact batch claim + `transmitting` is the durable authority. Settlement’s claim/fence CAS enforces it structurally.

### Verdict

**Mode-only settlement under the durable transmitting claim; confidence very high. Already handled correctly.**

There is no remaining settlement-policy ruling unless the author rejects the general durable-handoff rule. The reservation/pre-transmit authority boundary still needs its separate correction.

### Load-bearing regression

For the recommended ruling:

1. Retirement before reservation: no durable intent and zero Expo calls.
2. Reservation/transmitting wins; then session logout or service revocation commits; a fake Expo returns tickets; settlement succeeds from the claim.
3. Assert exact ticket, receipt schedule, message state, and any provider-driven token retirement.
4. Crash/suppress after transmitting; advance past the claim lease; assert exactly `ambiguous` and no automatic resend.

The existing test only proves global-mode retirement refuses the settlement and the mode guard spans commit ([admission_fence_tests.rs:1780](crates/snapback-engine/src/local/admission_fence_tests.rs:1780)); it does not prove logout/revocation-after-handoff semantics.

## 3. Capability-link use settlement

### Irreversible cut

The public link bearer is the complete credential; the route installs no caller session authority ([server.rs:10748](crates/snapback-server/src/server.rs:10748)). The governing contract also says the original minting session’s liveness does not govern link life ([LLP 0204:900](llp/0204-app-external-surfaces.rfc.md:900)).

Before invoking the function, consumption atomically:

- requires active, unexpired, unexhausted link state;
- requires a live minter principal;
- decrements remaining uses;
- increments `use_count`;
- writes `last_outcome = 'admitted'` ([capability_links.rs:529](crates/snapback-kernel/src/storage/capability_links.rs:529), [capability_links.rs:541](crates/snapback-kernel/src/storage/capability_links.rs:541)).

The server then invokes the query/mutation/action and only afterward computes a bounded outcome and settles ([server.rs:26019](crates/snapback-server/src/server.rs:26019), [server.rs:26030](crates/snapback-server/src/server.rs:26030), [server.rs:26077](crates/snapback-server/src/server.rs:26077)).

Thus the capability use is definitively consumed before settlement. The underlying invocation may have succeeded, failed, or produced a pending approval; it is not uniformly an irreversible external effect.

### What the write records

There is no durable consumed-use row.

The only table is `_snapback_capability_links`, with aggregate `remaining_uses`, `use_count`, `last_used_at_ms`, and `last_outcome` fields ([capability_links.rs:32](crates/snapback-kernel/src/storage/capability_links.rs:32)). `ConsumedCapabilityLinkUse` is an opaque process-local `{link_id, ordinal}` value ([engine.rs:3252](crates/snapback-engine/src/local/engine.rs:3252)).

Settlement updates only `last_outcome` and `updated_at_ms`, and only when the row’s current `use_count` still equals that ordinal ([capability_links.rs:567](crates/snapback-kernel/src/storage/capability_links.rs:567)). It does not change remaining uses, status, function binding, approval, or grant state.

Consequently, “consumed-use record” is not an accurate description of the current structure. This is a lossy latest-use projection. If another use consumes first, an earlier settlement becomes a silent no-op because the changed-row count is ignored.

### If settlement is suppressed after revocation

The use remains consumed. It does not rearm:

- `remaining_uses` stays decremented;
- `use_count` stays incremented;
- `last_outcome` remains `admitted`.

The existing global-mode test proves exactly that residual state ([admission_fence_tests.rs:1548](crates/snapback-engine/src/local/admission_fence_tests.rs:1548), [admission_fence_tests.rs:1581](crates/snapback-engine/src/local/admission_fence_tests.rs:1581)).

For an exhausted single-use link, the stale `admitted` outcome is permanent. For a multi-use link, a later use may overwrite it. This is detectable in the internal row but not self-healing as an exact historical account.

### If settlement is not suppressed

A settlement after revocation can update `last_outcome` and advance generic `updated_at_ms`, because its SQL does not require `status = 'active'` ([capability_links.rs:580](crates/snapback-kernel/src/storage/capability_links.rs:580)). That means the row’s last-update timestamp can postdate revocation.

It cannot reactivate the link, restore a use, confer a grant, or initiate the function. The outcome is server-derived from the completed response, not raw caller text. A bearer can complete one invocation after revocation only if consumption won the serialization race first; if revocation wins first, the consume CAS fails.

### Third option / handoff rule

This is already mostly implemented:

- the consumption transaction is the authority linearization point;
- revocation and consumption serialize on the same row;
- the opaque consumed token is consumed by value at the engine settlement API;
- storage matches its ordinal before updating.

That is sufficient for the current best-effort aggregate telemetry contract. It is not sufficient if `last_outcome` is intended to be a truthful per-use journal; that would require durable per-use rows keyed by ordinal.

### Verdict

**Mode-only; already correct for authorization. Confidence high.**

The author should separately clarify whether `last_outcome` is intentionally best-effort latest-use telemetry. If exact per-use truth is required, this is a storage-model gap, not a reason to attach settlement to a live session or revoked bearer.

### Load-bearing regression

For the recommended ruling:

1. Revocation wins before consume: no invocation, no decrement.
2. Consume wins first: revoke the link while the function is paused; allow exactly that invocation to finish; settlement may update outcome but must leave status revoked and remaining uses decremented.
3. Race two allowed uses and settle them out of order. If latest-use telemetry is intended, assert the older ordinal cannot overwrite the newer one.
4. For a single-use link, suppress settlement and assert the link remains exhausted with `last_outcome = admitted`.

If the author requires exact per-use journaling, the regression must instead retain independent outcomes for both ordinals. Current storage cannot pass that test.

## The question the author actually has to answer

When a live caller authorizes a durable handoff and then logs out or is revoked, does retirement:

1. **Block only new handoffs** while the durable predecessor owns completion and settlement — recommended; or
2. **Retroactively veto settlement**, accepting stranded Ask reservations, downgraded push truth, and stale capability telemetry?

For push, option 1 is already structurally implemented. For capability settlement, option 1 is already safe because consumption, not settlement, consumes authority. For Ask, option 1 is the right policy but requires the durable run/turn structure the proposed handoff design already calls for.
