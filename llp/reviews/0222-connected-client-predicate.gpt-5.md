# Review artifact — LLP 0222 (GPT family)

**Round:** 1
**Date:** 2026-08-10
**Target:** llp/0222-connected-client-predicate.rfc.md (revision b, blob 6c660b6d004dcc6c31ea0b23e81222fdbc71d0a9)
**Capsule:** sha256-16 1b79f85dc33a33db (target + Related LLPs 0008/0013/0028/0045/0053/0143/0201 + benchmark record + issue ticket + guide/capabilities.md + guide/realtime/live-queries.md + code copies/excerpts; llp/reviews/* excluded)
**Reviewer runtime:** codex exec, gpt-5.6-sol, model_reasoning_effort=xhigh, --sandbox read-only, capsule cwd
**Verdict:** NOT READY

---

The review below is sealed verbatim as received (final codex message after the last "tokens used" marker; the leading token count line is part of the raw capture).

---

176,308
Overall, the action-only transport predicate is well-motivated and its advisory/non-durable boundary is mostly sound. Five material contract issues remain.

C1 — **MATERIAL**

Exact passage: “Known close, revocation, supersession, or grant retirement removes the witness immediately,” plus implementation removal on “revocation.”

Why it matters: “revocation” is ambiguous and conflicts with LLP 0053’s explicit distinction between permission revocation and session-authority transitions. Losing group membership must not make an otherwise connected principal disappear globally. Conversely, session/grant expiry is not explicitly covered, despite `true` requiring a “current, session-authenticated” socket.

Minimal fix: Specify that socket close/supersession and session, credential, or connection-grant revocation/expiry/retirement remove the exact witness. State that application permission or membership revocation does not, unless it also terminates transport authority. Add expiry and partial multi-session revocation to Phase 1 proof.

C2 — **MATERIAL**

Exact passage: the implementation removes witnesses on “reset,” while pinned semantics mention no reset boundary and compatibility says only process restart clears witnesses.

Why it matters: LLP 0008 says `app.reset` can leave a connected tab able to resnapshot. Unconditionally deleting its witness would make a current authenticated socket return `false`, potentially indefinitely if refresh cannot recreate a removed entry. Allowing refresh to recreate it without a pinned generation rule creates the opposite stale-resurrection hazard.

Minimal fix: Remove unconditional application-reset deletion. Preserve or generation-safely rebind witnesses for sockets retained across reset; remove them only when reset actually terminalizes their transport. Add a reset-with-connected-socket acceptance case.

C3 — **MATERIAL**

Exact passages: Option A says membership-audience callers “must resolve recipients themselves”; the Decision says a mutation “enqueues an action” that checks freshness before `ctx.push.send`; Phase 4 expects the Clique push path to replace its heartbeat table.

Why it matters: LLP 0143 D2 requires deferred mutation-produced sends to use captured, execution-time host-resolved membership audiences and explicitly forbids arbitrary principal lists. Supplied action code also denies raw database reads. Therefore a deferred action cannot generally enumerate a membership audience, filter it with this predicate, and send the filtered list. The stated recipe and motivating validation overclaim what Option A can compose with.

Minimal fix: State that V1 can filter only flows already holding an authorized bounded principal set or an effectively single-principal audience. Host-resolved multi-recipient membership audiences remain unsuppressible under Option A and feed the recorded Option B gate. Scope Phase 4 to an actually admissible audience/trigger shape. This does not require advancing Option B.

C4 — **MATERIAL**

Exact passage: the capability row contains an unspecified `semanticsVersion`; codegen emits the surface when the capability is reported; OQ2 says widening to poll transport requires a version bump.

Why it matters: A version bump prevents silent semantic change only if consumers negotiate or reject versions. As written, codegen appears to test presence alone, so a future version that counts poll clients could silently change V1’s promised `false` result.

Minimal fix: Pin `semanticsVersion: 1` and state the compatibility rule: codegen/runtime admit only a supported semantics version; missing or unsupported versions omit/refuse the surface rather than inheriting new truth conditions.

C5 — **MATERIAL**

Exact omission: the operation accepts an arbitrary `principalId`, and the RFC acknowledges online-oracle/fingerprinting risk, but never pins its authorization boundary.

Why it matters: LLP 0013 calls global online status privacy-sensitive. Implementers could reasonably enforce caller-equals-target, audience authorization, or no additional check; those choices materially change whether cron/system push routing works and what privacy guarantee exists.

Minimal fix: Explicitly state the intended trust contract. If action code may inspect any principal in the current app, say that no target-principal authorization is performed, the result never crosses directly to client/query/mutation surfaces, and handlers must authorize any user-visible projection. Add this warning to the guide amendment.

C6 — **MINOR**

Exact passage: the 15-second budget is described as matching client defaults, mentioning only overridable `heartbeatIntervalMs`.

Why it matters: the supplied live-query guide also shows caller-configurable `stream.freshnessBudgetMs`. The server predicate can therefore return `true` while that client considers its connection stale.

Minimal fix: Add an explicit non-promise that the predicate does not reflect the client’s configured freshness budget or client-side connection axis.

C7 — **MINOR**

Exact passage: “within the fixed server freshness budget,” paired with proof of “exact 15 s expiry.”

Why it matters: equality at exactly `lastSignal + 15_000 ms` is undefined.

Minimal fix: Pin either `age < 15_000` or `age <= 15_000` and use the same boundary in tests.

C8 — **MINOR**

Exact passage: “grants deliberately survive ordinary socket close (LLP 0053).”

Why it matters: the supplied server excerpt establishes that fact and attributes connection grants to LLP 0031; LLP 0053 governs the generation/invalidation witness rather than ordinary grant lifetime.

Minimal fix: Cite the server lifecycle excerpt or the actual connection-grant authority, retaining LLP 0053 only for the relevant generation/invalidation identity.

VERDICT: NOT READY

---

# Review artifact — LLP 0222 (GPT family), round 2

**Round:** 2
**Date:** 2026-08-10
**Target:** llp/0222-connected-client-predicate.rfc.md (revision c, blob 4bed1062982c1782b7f4387389de5602f5e42e12)
**Capsule:** sha256-16 1813d3ced3a62c9e (target rev c + Related LLPs 0008/0013/0028/0031/0045/0053/0070/0143/0201 + benchmark record + issue ticket incl. 2026-08-10 author ruling + guide pages + code copies/excerpts; llp/reviews/* excluded)
**Reviewer runtime:** codex exec, gpt-5.6-sol, model_reasoning_effort=xhigh, --sandbox read-only, capsule cwd, blind to round 1
**Verdict:** NOT READY

---

The review below is sealed verbatim as received (final codex message after the last "tokens used" marker; the leading token count line is part of the raw capture).

---

133,764
Revision c is not ready because it contradicts the later, explicit author ruling in the governing issue. I did not relitigate the four binding design decisions.

### C1 — MATERIAL / IN-DELTA

**Passage:** “Poll-only clients count as `false` … This is the default case … Only `transport: 'stream'` clients produce witnesses,” reinforced by the new Phase 3 and Phase 4 stream pins.

**Why it matters:** The issue’s author ruling requires OQ2 to “widen the transport contract where needed for the predicate to be truthful for real clients.” Revision c instead codifies the shipped default transport and fallback as permanently false in v1.

**Minimal fix:** Fold the ruling into v1 by pinning the widened transport witness, capability facts, and proofs for poll/fallback clients; remove the stream-only phase constraints. Alternatively, record a newer explicit author ruling rescinding the ticket decision.

### C2 — MATERIAL / IN-DELTA

**Passage:** “Non-sessions auth modes (dev/impersonation) likewise report the capability absent,” plus Phase 2’s corresponding refusal proof.

**Why it matters:** This newly added fence conflicts with the ticket’s instruction to ship the whole surface “enabled by default” with “no conservative v1 fence.” It leaves entire supported local modes unable to exercise the feature.

**Minimal fix:** Pin how those modes bind a principal to transport authority and advertise the predicate there, with honest mode-specific proofs. If session-only remains desired, it needs a newer author ruling explicitly narrowing the ticket.

### C3 — MATERIAL / PRE-EXISTING

**Passage:** “Multi-instance/hosted targets report Missing until one authority (or a shared index) can aggregate,” and OQ1 leaves that aggregation unanswered.

**Why it matters:** The ticket explicitly resolves OQ1 in the opposite direction: attempt the hosted/multi-instance aggregation story rather than fence it out as Missing. The RFC currently makes the rejected fence part of v1.

**Minimal fix:** Select and pin one aggregation posture, bring it into the implementation phases and proofs, and remove hosted Missing as the planned v1 outcome. Problems discovered while implementing it may become follow-up tickets, as the ruling directs.

### C4 — MATERIAL / PRE-EXISTING

**Passage:** OQ3 asks whether the “not for exactly-one-of-live-or-push delivery” boundary should be added to LLP 0045 now or later.

**Why it matters:** The author ruling already answers “now.” LLP 0045 in the capsule still lacks that normative boundary, so an explicitly closed decision remains presented as open.

**Minimal fix:** Add the normative race/arbitration boundary to LLP 0045 now and replace OQ3 with a resolved reference to that amendment.

### C5 — MINOR / PRE-EXISTING (altitude)

**Passages:** Semantics require a socket that “has produced a client-originated signal,” while the implementation sketch says to “initialize on successful authenticated attachment” and only subsequently refresh from client-originated frames.

**Why it matters:** Before the first frame, the literal truth condition and sketched behavior differ.

**Minimal fix:** State explicitly whether authenticated attachment counts as the initial qualifying signal—apparently the intended answer—and pin that boundary in one proof.

### C6 — MINOR / IN-DELTA (altitude)

**Passage:** The generated surface is described as a `RealtimeContext` “on `ActionContextBase`,” while the same revised paragraph requires target-manifest-dependent omission.

**Why it matters:** The copied type surface uses the fixed base plus a conditional intersection for `push`; adding `realtime` literally to the base would expose it on unsupported targets, contradicting omission.

**Minimal fix:** Describe `realtime` as a conditional `ActionContext` slot parallel to `push`, rather than an unconditional member of `ActionContextBase`.

**Pre-existing text status:** Not clean. C3 and C4 are MATERIAL concerns outside the delta because the later governing author ruling changed their disposition. No other MATERIAL pre-existing design concern was found.

VERDICT: NOT READY
