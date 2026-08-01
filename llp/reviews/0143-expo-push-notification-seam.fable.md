# LLP 0143 Expo push-notification seam review — Fable family


## Round 1 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, non-author
session (this reviewer built the 0137 A1 web arm, the A1/Firebase probe, and
carries the Track B findings context the RFC cites; it did not author 0143)
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** read-only review of the working tree at the pinned revision;
mutually blind — no `llp/reviews/` artifact concerning LLP 0143 read, blind
to any 0143 codex artifact. Citations verified against the tree (runtime
egress seam, packaged/main client surfaces, finding JSONs, closed ticket,
frozen Expo receipt manifest, LLP 0028/0036/0045/0053/0070); Expo push
surfaces sanity-checked from reviewer knowledge.
**Target:** `llp/0143-expo-push-notification-seam.rfc.md` (369 lines, Draft)
**Target SHA-256:** `16ec3b562c4ff9b8a595ce07d6f6c337b933cf68f21f9ed406adf065225bacf7`
**Repo revision at review start:** origin/main `a8dcb148`
**Tool uses:** ~12 (review phase)
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## Overall assessment

**Verdict: NOT READY** — narrowly; one revision round should clear it.

This is a well-framed Draft whose decided frame (seam to Expo's push
service, not first-class delivery) is the right call for exactly the
reasons recorded, and whose three-piece split — token custody, host-side
send lane, honesty-first handoff ledger — targets precisely what the naive
app-authored bridge gets wrong. The as-built citations are unusually good:
every tree claim I checked is accurate, several to the line
(`src/runtime.rs` host.fetch + `SNAPBACK_OUTBOUND_ACTIONS`; commit
`117dcae2`; `authTerminalStatus`/`subscribeAuthTerminal` present in
`packages/snapback-client/index.mjs` on main; the closed
`a4expo-f1` ticket; `EXPO-09-PUSH` in the frozen expo-receipt manifest;
LLP 0045's verbatim open question at line 183; LLP 0070's runAfter
action-callee scope). The Expo surface descriptions (token acquisition
with EAS projectId, the 100-message send API, tickets-then-receipts, the
error-code vocabulary, the ~1-day receipt window, enhanced-security
bearer, no-delivery-claims) match the provider's actual contract.

It is not ready because two load-bearing design claims are not yet thought
through against facts the RFC itself cites, and both sit at the document's
own center of gravity — honesty and custody. First, the dedupe story
overstates what the composed system can promise: Expo has no server-side
idempotency, so retrying an `ambiguous` attempt under the same dedupe key
can deliver the same notification to the device twice — the one
dishonesty this seam's own mechanism can produce, and the text ("one key =
at most one handoff attempt chain", "retry ... without duplicating
messages") currently implies otherwise. Second, D1 keys the registry by
"the client-store identity the packaged client already mints" — but on
the Expo carrier that identity does not exist (`a1expo-f3`, cited by this
RFC: every RN client resolves the in-memory store), and on web/node the
default identities are origin-keyed or caller-supplied, not
installation-shaped. The registry's key rests on an identity the seam
must actually mint, and the RFC's citation set contains the
contradiction.

## Strengths

- **Decided-frame discipline.** D0 records the option decision with
  reasons, and every subsequent section stays inside it. The absorption
  plan into LLP 0045 (D6) — with the explicit commitment not to invent
  ledger fields the outbox lifecycle cannot carry — is how a seam should
  defer to a capability owner.
- **The custody/authorization/honesty split matches the observed failure
  modes.** Token rows in app tables, no retirement, no honest receipts —
  the exact hazards the A4 arms scaffolded around. The never-claims list
  (delivery, display, read, permission state) is normative and verbatim-
  bound for the guide page; the Firebase reference probe's counter-
  observations show how rare that posture is.
- **Ledger naming as the honesty surface** (`handedToExpoAt`,
  `expoAcceptedAt`, no `deliveredAt` anywhere) plus the A4-10 `ambiguous`
  discipline is the house style applied correctly to a two-stage provider
  protocol.
- **Composition claims are real, not aspirational.** Egress seam, config
  grants, runAfter/cron action targeting, terminal-auth choke point —
  all verified present. D5's acceptance shape names its one true
  dependency (`a4-f5`).
- **No-op posture (D6)** — declare nothing, pay nothing — and the
  fixture-endpoint testability posture in D4 both follow the sweep's
  scripted-provider idiom.

## Concerns

1. **[moderate] Ambiguous-retry can double-deliver, and the dedupe text
   implies it cannot (D2/D3).** Expo's API has no server-side
   idempotency; the dedupe key exists only in Snapback's ledger. If the
   Expo POST times out after Expo accepted (state `ambiguous`), a retry
   under the same key (attempt-seq increment) re-hands the same message
   and the device can display it twice. For a seam whose thesis is
   receipt honesty, this must be named: either (a) the seam never
   auto-retries `ambiguous` (only `failed`), requiring an explicit
   re-drive with the duplicate risk stated, or (b) the at-most-once claim
   is scoped to "per attempt, not per device-display" in D3 and the
   never-claims vicinity. Cheap fix, core claim.
2. **[moderate] The registry key's installation identity does not exist
   on the target carrier (D1, OQ2).** `a1expo-f3` (this RFC's own
   citation) establishes there is no durable client-store identity on the
   Expo carrier today; web defaults are origin-keyed and `clientStoreId`
   is caller-supplied. OQ2 treats this as a naming choice; it is a
   dependency: the seam must mint and persist an installation identity
   (plausibly beside auth custody, since the registry needs durability
   the RQS store does not provide on RN), and its lifecycle across store
   reset / reinstall decides whether stale token rows accumulate.
   Promote from open question to a named dependency with a default
   proposal.
3. **[moderate] Same token bytes under multiple principals is
   unanalyzed (D1).** One device serving two principals (user switch,
   shared device) yields the same token bytes under two live
   `(principal, installation)` rows; a send addressed to principal A then
   displays on a device currently signed in as B, including whatever
   protected content the app put in `data`. Given the custody framing, D1
   should state a single-owner rule (registering token bytes already held
   by another principal's live row retires the predecessor) or record the
   cross-principal display risk explicitly.
4. **[minor] Payload privacy posture absent.** Title/body/data transit
   Expo and APNs/FCM. One normative sentence (and a guide-page warning)
   about protected row data in push payloads would match the corpus's
   non-disclosure posture.
5. **[minor] No rate/pacing posture.** `MessageRateExceeded` is cited as
   a receipt code, but D2 declares no send budget or pacing behavior for
   chunked fan-out; say whether the platform paces and how that receipt
   surfaces to the app.
6. **[minor] "Simulators" is overbroad in D4.** iOS simulators cannot
   mint Expo push tokens; Android emulators with Play services generally
   can. Either scope the fixture rule per-OS or state uniform-fixture as
   a deliberate determinism choice.
7. **[minor] Ledger read surface needs a packaged-closure result
   contract.** The declared read surface (D3) implies platform-shaped
   rows flowing through generated contracts; `0137-a1-f1` (AssetRef made
   tables unqueryable on the closure) is the precedent for that surface
   cracking. Add "contract-expressible on the packaged closure" to the
   D6 absorption commitment.
8. **[minor] a4-f5 as an explicit gate.** D5 mentions the dependency
   inline; a one-line sequencing note (or open question) stating the
   acceptance witness cannot pass until the action-boundary auth-code
   collapse is fixed would make the gate legible to the implementer.

## Coverage

- Verified against the tree: egress seam + env gate in `src/runtime.rs`;
  `117dcae2` exists with the a4-f1/a5-f1 narrowing subject; closed
  `a4expo-f1` ticket in `issues/closed/`; `EXPO-09-PUSH` in
  `demos/improvement-sweep/protocol/expo-receipt.v1.json`;
  `authTerminalStatus`/`subscribeAuthTerminal`/`handleTerminalAuthLoss`
  in main's client (the first two are main-only, not in packaged 0.1.7 —
  consistent with the RFC's "recorded pattern" phrasing, but worth
  knowing the packaged closure only carries `handleTerminalAuthLoss`);
  LLP 0045 email-first + the verbatim push-provider open question;
  LLP 0036 `uses`/`ctx.secrets`/status discipline; LLP 0070 runAfter
  action callees; `a4-f5` and `a1expo-f5` finding JSONs.
- Sanity-checked from knowledge: all cited Expo push surfaces (accurate;
  one nuance in concern 6).
- Not verified: no code was run; LLP 0053's internal invalidation
  machinery was checked for existence/ownership, not re-derived.

## Open questions (reviewer additions)

- Should `ambiguous` attempts ever auto-retry (concern 1), and does the
  ledger record device-duplicate risk on explicit re-drive?
- What mints and persists the installation identity on the Expo carrier,
  and what happens to registry rows on store reset/reinstall (sharpens
  OQ2 into a dependency)?
- Is a token-bytes single-owner rule normative (concern 3)?
- The RFC's OQ8 (audience shapes): the A4 fit wants membership-resolved
  audiences; note that host-side resolution at *execution* time (not
  enqueue time) is what makes deferred sends respect retirement — worth
  pinning as a normative rule when OQ8 resolves.

## Verdict and next step

**NOT READY.** The frame, scope, citations, and honesty posture are
right; concerns 1-3 are each one-paragraph design decisions, not
rethinks, but two of them sit under load-bearing claims (the dedupe
honesty story and the registry key) and should be resolved in the text
before this advances. Suggested next step: author revision addressing
concerns 1-3 (normative text), folding 4-8 as one-line additions or open
questions, then a round-2 pass.


## Round 2 — 2026-08-01 (delta review of v2)

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, same
non-author session as round 1
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** delta review — verify each round-1 concern against the v2 text,
then a full read of the new/changed sections (D1a-D1d, D2a-D2e, D3a-D3f,
D4-D6, revised Expo surface facts, open questions) for fresh defects. Blind
to the codex artifact; the v2 Revised entry's dispositions were checked
against the text, not taken on faith. New tree claims verified
(`rqs-store-expo.mjs` expo-file-system adapter present on main;
LLP 0039 auth vertical slice owns session-end transitions).
**Target:** `llp/0143-expo-push-notification-seam.rfc.md` (637 lines, Draft, v2)
**Target SHA-256:** `35f0a6e2fd8ff29e9aae13fa1453725c3c894ea2b6be4012d2ef5180feab773f`
**Repo revision at review start:** origin/main `9224c01a`
**Tool uses:** ~7 (review phase)
**Status:** completed
**Verdict:** READY

## Verbatim review

## Overall assessment

**Verdict: READY** — with one named must-fix line (concern R2-1) that
should be applied before or with implementation; it does not change the
design shape.

All eight round-1 concerns are resolved in normative text, not prose
gestures, and each resolution is the stronger of the available options:

- **c1 → D3c/never-claims:** at-most-once is scoped per handoff attempt;
  `ambiguous` is never auto-retried; an explicit re-drive records "the
  device may receive the notification twice" as a normative guide
  sentence; the never-claims list now includes exactly-once/duplicate
  suppression. This is precisely the honesty the round-1 concern asked
  for.
- **c2 → D1a:** promoted to a named dependency with the as-built facts
  stated correctly (verified: the B1 RN durable-store arm
  (`rqs-store-expo.mjs`, expo-file-system adapter) is on main; the
  caller-supplied/origin-keyed identity facts match the A1 arms'
  observations), a default proposal (seam-minted id beside auth
  custody), a bounded-staleness argument, and OQ2 narrowed to final home
  and reset semantics. The `appScope` addition closes the cross-project
  token-domain hole unprompted.
- **c3 → D1b:** normative single-owner rule with same-transaction
  predecessor retirement and the cross-principal display risk named.
- **c4 → D2e**, **c5 → D2a/D3e/OQ9** (pacing as published manifest
  facts is the right register), **c6 → D4** (per-OS facts stated,
  uniform fixture kept as an explicit determinism choice), **c7 → D6**
  (packaged-closure-expressible read contract, joined to the absorption
  commitment, citing a1-f1), **c8 → D5** (a4-f5 as an explicit gate
  with the exact collapse named).

The v2 additions beyond my round-1 scope are also sound where I can
check them: the corrected Expo facts (token object shape, ticket-stage
`DeviceNotRegistered`, request-level `UNAUTHORIZED` vs receipt-level
`InvalidCredentials`, 1,000-id receipt chunks, ~15-minute/~24-hour
windows, no server-side idempotency) all match the provider's actual
contract; the D2b trigger-mode redesign around LLP 0070's real
system-authority job lane with capture-then-revalidate and
execution-time audience resolution is the honest composition, and the
D2d endpoint-pinning rule (overrides operator-owned, test-profile,
loopback-only) closes an exfiltration lever the A4 arms' idiom would
have reproduced. The D1c retirement lanes sit correctly on the
0039/0053 division. D1d's allowlist-not-prose persistence rule
(provider messages can echo token bytes) is a detail I did not ask for
and am glad to see.

## Fresh concerns (v2 text)

1. **[moderate — the one must-fix] D3b's crash discrimination needs its
   durable marker named.** Recovery is said to distinguish "after
   reserve, before transmit — re-drive, no bytes were sent; safe" from
   "after Expo accepted bytes, before ticket persistence — settle
   `ambiguous`", but both crash points leave a claimed attempt with no
   ticket rows. The discrimination is only sound if a durable
   transmit-start marker is written after claim and before any bytes
   leave the host; the protocol implies such a state ("finds a
   transmitted-but-unsettled attempt") but never declares the write
   that creates it. As written, an implementer could ship claim →
   POST with no intervening durable transition, and recovery would
   re-drive a possibly-transmitted attempt — a silent double-send, the
   exact class this section exists to prevent. One normative line
   fixes it: a durable `transmitting` transition precedes the first
   byte; recovery treats claimed-without-marker as safe re-drive and
   marker-without-settlement as `ambiguous`.
2. **[nit] D1b vs D1a key scope.** "Token bytes have at most one live
   row" reads as global, while the registry key includes `appScope`;
   legitimate cross-`appScope` duplicates should be impossible
   (Expo tokens are project-scoped), but the rule should say whether
   single-ownership is per `appScope` or global so a cross-scope
   collision (which would indicate token leakage) has a defined
   outcome.
3. **[nit] Capture-grant authorization locus.** D2b's captured send
   grant is minted by the producing mutation; the authorization of the
   *resolver itself* (who may capture which audience) is deferred to
   OQ8's "how a resolver's own authorization is declared". That is an
   acceptable open question, but D2b could cross-reference it so the
   capture step isn't read as authorization-free.

## Coverage

- Verified in v2 text: all eight round-1 dispositions (c1-c8), the
  extended never-claims list, the D3e outcome matrix's internal
  consistency with D3c/D3d, the D5 witness's new per-stage
  `DeviceNotRegistered` and ambiguity legs, D6 activation/no-op
  posture.
- Verified against the tree: `rqs-store-expo.mjs` +
  `fake-expo-file-system.mjs` + RN/expo resume tests on main (the D1a
  B1 claim); LLP 0039 existence and session scope; the a1expo-f5
  conjunction phrasing against the finding.
- Sanity-checked from knowledge: the corrected Expo API facts (all
  accurate).
- Not verified: LLP 0070's lease idiom internals beyond existence;
  codex dispositions m1-m7/s8/d9 were checked only where they
  intersect the text I read (all consistent), not against the codex
  artifact, which remains unread.

## Verdict and next step

**READY.** The document now thinks through everything round 1 found
wanting, and the fresh material holds up. Apply concern R2-1's one
normative line (the durable transmit-start marker) — ideally as a v2.1
edit or with the first implementation commit — and fold the two nits
where convenient. No further Fable round is needed unless the author
restructures D3b.


## Round 3 — 2026-08-01 (targeted review of v3)

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, same
non-author session as rounds 1-2
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** targeted delta — verify the round-2 must-fix and both nits
against the v3 text, then a mobile-lens spot-check of the round-2
Codex-driven additions (host-enforced authorize clauses, rotation-signal
reacquisition, pinned poll schedule, MessageTooBig reclassification,
idle-retention GC). Blind to the codex artifact throughout.
**Target:** `llp/0143-expo-push-notification-seam.rfc.md` (730 lines, Draft, v3)
**Target SHA-256:** `019659ae8fb9f94178571dd8d64c90123363e3ce6724512d9d61ce517c0ffbb9`
**Repo revision at review start:** origin/main `b0bf4594`
**Tool uses:** ~5 (review phase)
**Status:** completed
**Verdict:** READY

## Verbatim review

## Overall assessment

**Verdict: READY** — the must-fix is resolved exactly as asked, both
nits are resolved beyond what was asked, and the new material survives
the spot-check. No further Fable round is needed.

- **R2-1 (must-fix) → D3b step 3, resolved.** The durable
  `transmitting` transition is now a normative, named step written
  "before the first network byte leaves the host", explicitly labeled
  the crash discriminator; recovery is discriminated by the marker
  (claimed-without-marker → safe re-drive; marker-without-settlement →
  `ambiguous`), and an attempt past the transmit boundary is never
  automatically re-driven — only D3c's explicit re-drive, which records
  the duplicate risk, may follow. This is precisely the line round 2
  required, in the right register.
- **R2 nit 2 → D1b, resolved and improved.** Single ownership is
  scoped per `appScope`; a cross-scope collision refuses the
  registration and records a leak-indicator diagnostic instead of
  silently retiring either row — the correct treatment, since
  cross-scope duplicates are illegitimate by construction. `appScope`
  itself is now a declared (EAS project id, application identity,
  environment profile) tuple fixed in `definePushSeam`, closing the
  inference ambiguity as a bonus.
- **R2 nit 3 → D2b/D2c, resolved.** The capture step is explicitly
  host-evaluated ("at capture the host evaluates the audience's
  `authorize` clause as the producer"), the resolver-authorization
  declaration is cross-referenced, and OQ8 now owns the clause
  vocabulary question.

Spot-check of the round-2 Codex-driven additions, from the mobile lens:

- **Host-enforced authorize clauses (D2b/D2c):** the right boundary
  move — the host evaluates a declared clause (LLP 0100 vocabulary) in
  all three trigger modes, demoting the app-side `requireRole` idiom to
  defense in depth. Composition with LLP 0053 invalidation and
  capture-then-revalidate is coherent.
- **Rotation-signal reacquisition (D1c):** accurate to the SDK —
  `addPushTokenListener` does fire with the native `DevicePushToken`,
  and treating it as a signal to reacquire via `getExpoPushTokenAsync`
  before re-registering is the correct pattern; the
  backgrounded-rotation catch-up via foreground refresh is the honest
  residual.
- **`MessageTooBig` reclassification (D3e):** correct — it is a
  receipt-stage error in Expo's documented vocabulary; the ticket-stage
  catch-all ("any other enumerated ticket error → failed-permanent") is
  a safe generalization.
- **Pinned poll schedule (D3d):** internally consistent (15 m + 30 m +
  1 h + 2 h + 4 h + 4 h + 4 h ≈ 15.75 h across seven polls, inside the
  ~24-hour receipt window), published as manifest facts beside pacing.
- **Idle-retention GC (D1a):** the "bounded, not accumulated" claim is
  now earned — the stranded-reinstall case is named, and the declared
  idle window ("no successful handoff and no re-registration") cannot
  retire a device that is actually receiving sends; foreground
  re-registration recovers a retired-but-valid installation.

## Residual nits (cosmetic; no further round required)

1. **[nit] Mode-3 send-time revalidation subject.** D2b says the clause
   is "re-evaluated" at send time for deferred sends but does not name
   the evaluation subject; the design intent (evaluate against the
   captured `producerPrincipal`, so a producer who lost the role
   between enqueue and send stops the send) should be stated in one
   clause — re-evaluating as system authority would be vacuous.
2. **[nit] D3d's terminal phrasing.** "Terminal at the earlier of
   receipt arrival or the ~24-hour window close" — with seven polls
   exhausting at ~15.75 h, the window-close branch is unreachable;
   either phrase the terminal rule as schedule exhaustion (with the
   window as the outer bound rationale) or note the last poll is
   window-aligned.

## Coverage

- Verified in v3 text: D3b's transmit boundary and discriminated
  recovery list; D1b scope + cross-scope refusal/diagnostic; D1a
  appScope tuple + idle-retention rule and its D6 declaration shape;
  D2b/D2c authorize clauses across all three modes; D3d schedule; D3e
  matrix consistency after the reclassification; the updated Revised
  entry's Fable dispositions (all match the text).
- Sanity-checked from knowledge: `addPushTokenListener` native-token
  behavior, Expo receipt-error vocabulary, receipt-window guidance.
- Not verified: LLP 0100's declaration vocabulary internals (existence
  and fit taken from the tree's prior-art description); codex artifact
  remains unread.

## Verdict and next step

**READY.** Rounds 1-3 converged: the honesty and custody claims now
match what the composed system can actually promise, and the two
residual nits are one-clause wording items safely left to the author's
next editing pass. From the Fable side this document is ready to leave
Draft when the author and the codex family concur.
