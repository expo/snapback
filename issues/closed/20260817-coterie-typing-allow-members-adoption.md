# Coterie: adopt `allow.members` to claim M3 typing in the Snapback lane

**Opened:** 2026-08-17
**Source:** LLP 0277 F5; capability closure in
`issues/closed/20260817-ephemeral-membership-permission-backing.md`

## Work

The membership-backed ephemeral capability (`allow.members`) closed on main
on 2026-08-17, but Coterie does not gain typing automatically: the closure
record states its schema uses incarnation-oriented membership and must
migrate to a canonical `membership()` declaration before the posture can
bind. Steps:

1. Migrate the Coterie M3 conversation membership schema to declare the
   canonical current-membership relation (keeping the incarnation history
   rows for receipts/cutoffs — the current-projection split from the M3
   review already separates them).
2. Author the typing projection with `allow.members` per the landed
   typing-indicators guide recipe; keep the 2 s visibility / 5 s lease
   contract from the frozen v8 bridge extension.
3. Grow the adapter claim from M3-minus-typing: claim `observeTyping` /
   `setTyping`, delete the refusal that cites the closed platform ticket,
   and turn the two skipped-by-claim acceptance steps green.
4. Carry the capability's negative fixtures (anonymous, non-member,
   former-member observers and writers) into the Coterie acceptance run.

## Constraints

- Role narrowing closed on 2026-08-21
  (`issues/closed/20260817-ephemeral-membership-role-narrowing.md`); Coterie may
  still use the default complete active-role set, so its adoption shape is
  unchanged.
- The v8 declaration is byte-frozen; claiming typing changes only the
  adapter's claims/refusals, not the declaration, unless the Exact
  ephemeral-descriptor generation lands first (graduated to the Exact repo;
  local pointer
  `issues/closed/20260817-exact-ephemeral-declaration-generation.md`).

## Resolution

Resolved 2026-08-24. Coterie now keeps one canonical current-access seat per
principal/conversation in `conversationCurrentMembers.membership()`, while the
existing `conversationMembers` incarnation rows continue to own roles,
receipts, unread watermarks, join sequences, and removal cutoffs. Conversation
creation, member addition, removal, and leave update both projections
atomically; product-level admin promotion leaves the canonical access seat
unchanged.

This adoption is a documented **DESTRUCTIVE-WITH-RESEED** transition. It does
not backfill `conversationCurrentMembers`: every disposable Coterie database,
including one already created from the pre-typing M3 schema, must be reset and
then installed through `seed-m3.mjs`. The existing-conversation fixture paths
may otherwise return `matched` without reconstructing the canonical seats. A
future preserved-data deployment must use a separately reviewed migration and
explicit canonical-membership backfill before activating this schema.

The `typing` ephemeral collection uses connection-owned entries, an explicit
5,000 ms lease, and `allow.members('conversationCurrentMembers')` for both
publish and subscribe. Omitting `roles` selects the declaration's complete
active set, its sole `member` role. The adapter now claims `observeTyping@1`
and `setTyping@1`, projects one latest entry per external user, clears its own
lease on send/leave/auth loss, and reuses login/profile-stream identity on the
latency-critical publish path. The shared provider proof's two former
`skipped-by-claim` typing steps are required green steps.

The final 2026-08-25 recovery review also closes the two late-generation
edges. The headless overlay retains and synchronously replays buffered
`needs_resync`, `authority_changed`, and `authority_missing` results to the
first late listener. Coterie's cached publisher retires on `terminal_error`
and refuses to reuse any terminal overlay; the adapter integration removes
Carol, re-adds her, proves a successor `setTyping({ active: true })`, and keeps
the removed observer generation silent. The M3 installer now refuses before
network work unless its caller explicitly confirms the destructive reset, so
the reset/reseed adoption boundary is executable rather than documentary.

Non-vacuity is pinned separately: the expiry unit moves wall time backward and
distinguishes the monotonic delay from `expiresAtMs - Date.now()`, while the M5
acceptance witness rejects pre-publication-index, wrong-key, and wrong-room
mutants before accepting the fresh survivor `Upsert`.

Coterie's backend acceptance carries anonymous, authenticated non-member, and
former-member observer and writer denials. Existing incarnation churn,
receipt, unread/rejoin, quote/privacy, message-envelope, and chat-envelope
proofs remain green. The byte-frozen Exact v8 declaration and its generated
declaration products are byte-identical to `origin/main`.

Verification:

- Coterie M3 backend acceptance with both runtime/server binaries — 14/14
  named M3 subtests; the Node summary printed 16/16 total tests after counting
  the parent harness and standalone receipt-envelope test
- Coterie Snapback adapter integration with both binaries — the M3 live tails,
  fresh raw survivor frame, removed-overlay non-delivery, M2 live proof, and
  formal M1/M2/M3 conformance all passed; Bun then printed 97 assertions before
  the explicitly configured, stale-stamped server timed out in the unrelated
  post-conformance `setAvatar` profile-stream tail
- shared Coterie Snapback provider proof — 30/30, zero skipped claims
- shared Coterie memory provider proof — 30/30, zero skipped claims
- Coterie Snapback adapter unit tests — 15/15, 179 assertions
- Coterie Snapback codegen — 13 tables, 39 operations, one ephemeral collection
- `./ref-check --verbose`

Final recovery verification (2026-08-25):

- rebuilt and freshly handler-VM-qualified the explicitly requested
  `/Users/ccheever/projects/snapback/target/debug/snapback` at clean commit
  `e5fb30577ad7770d4279ec3c26177745b98da470`
- the single Coterie M3 backend acceptance run passed 16/16, including the
  executable reset/reseed guard and M5 negative mutants
- the combined adapter integration/unit run passed the pre-listener recovery,
  Carol removal/re-add successor publisher, removed-generation silence, M2
  live proof, and formal M1/M2/M3 conformance; Bun recorded 16 unit tests green
  and 283 assertions before the same unrelated post-conformance `listProfiles`
  delivery timeout. The fresh binary rules out the old stamp as the complete
  explanation, but the failing `attachMyAvatar` path remains profile-only and
  outside this typing/membership landing; profile behavior is unchanged
- headless hosted-ephemeral recovery passed; the standalone Coterie adapter
  unit suite passed 16/16 with 182 assertions, including the backward-clock
  discriminator
- diagnostics, symbol, and guide-manifest generator checks passed;
  `check-inventories` passed. `check-guide` passed its diagnostics, symbols,
  manifest, flat projections, corpus, links, and 15 other gates, with only the
  inherited benchmark raw-asset-accessor gate red
- `ref-check` passed with 0 errors; the full seven-file Exact v8 declaration
  and generated product set is byte-identical to `origin/main`
- the Coterie TypeScript check reached only the inherited external Exact
  `shape-validation.ts:67` missing-return error

Landing SHA: 7eeae982c0de4b569cc5396936f343f784870c86
