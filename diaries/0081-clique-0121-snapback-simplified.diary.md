# Diary 0081: Clique 0.1.21 Snapback Simplified exploratory lane

**Date:** 2026-08-14

**Run:** Clique 0.1.21 exploratory sweep on the Durand M4 Pro Mac mini

**Raw lane artifacts:** `/Users/ccheever/clique-0121-20260814/lanes/sol-snapback-simplified/`

**Lane:** `sol-snapback-simplified`

**Model:** GPT-5.6 Sol, high effort

**Backend:** Snapback Simplified 0.1.21

This is N=1 exploratory evidence from `sol-snapback-simplified`; it is not scored, claim-eligible, or a promotion/default decision.

## M1 boundary — 1786752145

Built built-in password accounts, durable session restoration/logout, unique validated handles, public profile reads, authenticated profile edits, and admitted public avatar upload/attachment. The Expo Router web client uses the frozen AuthForm and ProfileForm contracts, while the suite installs all eight personas idempotently and covers every suite-required M1 assertion. Acceptance passed 7/7; frozen choreography passed all 3 implemented checks; an iOS Hermes bundle is preserved under `artifacts/m1-ios`.

What felt easy: explicit named queries/mutations, public-read visibility, typed application refusals, and the asset intent/command split were direct once the exact package docs were in hand. The served auth and assets pages gave concrete lifecycle language and prevented a custom auth or upload path.

What fought me: the password provider defaults to a 12-character minimum even though Clique specifies at least eight, and repeated duplicate/sign-in probes could leave a correct auth request stalled until the exact backend child was restarted. The static tiny-data query catalogue only scans the backend source root, which was not obvious from app-level usage; an app-only descriptor produced a synchronous `SNAPBACK_DATA_QUERY_NOT_CATALOGUED` route crash. The generated dotted operation exports are valid modern ESM but Metro/Babel in this Expo tuple rejects arbitrary-string export aliases.

Documentation and workarounds: the served DataQuery guide identified the closed-chain grammar and refusal; package source revealed the backend-root scan and `_id` totalizer rule after an exact unique-index predicate. I added `snapback/data-queries.mjs` as the static catalogue source and retained the generated `db` descriptor in the profile screen. A small typed client shim hydrates the generated descriptor/data binding without re-exporting dotted names; it changes no backend, cache, outbox, or authority ownership. Persona replay now preflights the public profile list and only invokes real password auth for missing actors.

Backend-specific ownership/authority friction: public profiles cannot be written through simplified transactions, so server-derived-principal profile writes and avatar attachment remain named explicit functions. Asset admission is also explicit. Neither escape migrated data ownership or introduced a second client-side owner.

## M2 boundary — 1786753045

Built text/image/video posts, public immutable media, direct replies and chronological threads, follow/like/repost set-state APIs, follower/following counts, attributed repost events, and 20-row Following/Global pages. All five eligible public row resources expose `.data(...)`; literal query shapes live in the backend source root and generate closed descriptors. Acceptance passed all 22 suite-required assertions. Frozen choreography passed all 7 implemented checks; its 2 media live-delivery checks are structurally unimplemented because the frozen compose contract has no file-input selector. The M2 iOS Hermes export is preserved under `artifacts/m2-ios`.

What felt easy: the explicit-function model made server-derived identity and idempotent relationship intent unambiguous. Real image and MP4 admission used the same asset lifecycle as M1, and live JavaScript queries reliably invalidated computed feed counts and events.

What fought me: DataQueryV1 cannot express relationship joins, fan-in counts, repost events, or following-feed membership, and public-read resources intentionally generate no transactions. Consequently `db.transact` is not a legitimate write doorway for these resources; every write and cross-table projection is an explicit named escape. On the UI side, Expo Router retained route components long enough to expose duplicate composer IDs and stale dynamic-thread data until navigation used replacement and the composer was gated on an id-matched parent. The frozen harness also expects feed navigation to remain reachable from profiles.

Documentation and workarounds: the served data guide's relationship exclusion prevented an attempted generic-client join or second cache. I kept generated data descriptors for bounded row reads, while named queries own joined projections. A server-atomic UI follow toggle avoids stale client projection races, alongside the separate set-state mutation required by fixture replay. The test suite walks bounded pages when asserting whole-feed membership instead of assuming an older fixture remains in page zero.

Backend-specific ownership/authority friction: post authors, relationship actors, and media attachments must all be derived or authorized server-side. `feed`, `thread`, and `profileSocial` therefore own cross-table authority and aggregation. These escapes did not migrate client ownership or add a cache/outbox; Snapback's prepared binding remains the sole client owner.

## M3 boundary — 1786755019

Built pair-unique DMs, distinct same-roster groups, active membership/admin controls, text messages, immutable recipient snapshots, sent receipt rows, inbox and conversation projections, live two-client messages, connection-owned typing presence, and quoted reply excerpts with an actual scroll-to-original interaction. The frozen ChatListRow, Composer, MessageBubble, TypingIndicator, and their test IDs remain the client contract. Acceptance passed all 7 suite-required assertions, including Playwright automation for the single-client quote jump. The iOS Hermes export is preserved under `artifacts/m3-ios`.

What felt easy: DM pair uniqueness and group identity were straightforward explicit mutations, quoted reply storage/projection was simple once message relationships were visible to the handler, and the frozen UI components mapped cleanly onto the generated query/mutation references. The ephemeral collection API also avoided any durable typing table or client-authored identity.

What fought me: sessions deployment identity made the M2→M3 schema evolution unusually exacting. A partial early load had already materialized `recipientSet` as JSON; the later concrete-array version was correctly refused as a stored-field retype. Recovery required booting the preserved exact M2 carrier, then allowing the packaged dev successor path to advance the pin without discarding the database. More significantly, owner visibility is enforced on `ctx.db` reads inside explicit handlers. That prevented Bob from resolving Alice's quoted message and prevented conversation-wide roster/message joins. In this published profile, the richer membership authority profile would also impose a one-membership-command mutation model that does not fit atomic multi-seat fixture group creation. I therefore migrated conversation, membership, and message backing rows to public-read handler visibility while exposing no `.data` resource for them; every client-facing operation still authenticates and checks active membership or admin role in a named function. This is the lane's material ownership migration and its largest authority compromise.

Documentation and workarounds: packaged CLI source was decisive for the sessions startup-carrier and automatic-successor behavior, while the served scoped-role guide clarified why generic membership rows and handler reads are not equivalent to a declared authority profile. `recipientSet` remains server-derived `v.json()` because structured interiors reject principal validators and an already-stored JSON field cannot be retyped. M3 replay now preflights the exact frozen DM/group/message/member identities, avoiding unnecessary password-session churn. No second cache, outbox, presence transport, or policy bypass was added.

The boundary is failed, not green. The final frozen run passed live DM delivery and the optional quoted-reply check, and structurally skipped four optional checks the harness declares unimplemented. Its required typing check failed: visibility repeatedly arrived 45–126 ms beyond the 2-second ceiling, although expiry was consistently about 1.3–1.85 seconds after the last keystroke. One earlier raw run passed all 3 implemented checks, but it lacked suite-status input and was structurally non-green; I did not combine runs or claim that as green. I tried stable declarative values, immediate imperative publish, unique connection IDs, a 1 ms ephemeral dispatch setting, disabling local live coalescing, clean backend restarts, and a focus warm-up. None produced repeatable compliant timing, so the final receipt and capability failure remain honest.

## Addendum — 2026-08-15: the M3 typing red was a measurement artifact, not delivery latency

The failed typing boundary was root-caused and closed the same day
(`issues/closed/20260815-ephemeral-typing-first-visibility-misses-2s.md`,
landed in 3ec6b1782). Instrumenting every hop of the ephemeral publish →
fan-out → client-apply path showed first delivery is already eager: the
eight-sample two-client regression in
`demos/_kit/tests/regression-multiplexed-lanes.mjs` measured at most 1 ms per
segment and 1.68 ms from caller publish start to overlay apply. The
2,045–2,126 ms readings came from the frozen choreography's observation
boundary: it starts its clock, awaits the full ~45-character
`pressSequentially(..., { delay: 25 })` action, and only then begins waiting
for the already-visible indicator, so its reported `visibleMs` includes the
synthetic typing action and browser input/render overhead. That is why none
of the seven mitigations above could move the floor.
[LLP 0013 §First-delivery latency budget](../llp/0013-ephemeral-realtime-state.rfc.md#first-delivery-latency-budget)
now publishes a 1,000 ms accept-to-overlay-apply regression ceiling with
per-segment allocations and an observation-honesty rule that excludes
synthetic action duration. Correcting the frozen choreography's boundary and
rerunning this lane is tracked in
`issues/20260815-clique-choreography-typing-observation-boundary.md`.
