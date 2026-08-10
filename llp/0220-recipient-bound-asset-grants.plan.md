# LLP 0220: Recipient-bound asset grants — recipes, guide coverage, and the activation-TTL question

**Type:** Plan
**Status:** Draft
**Systems:** Assets, Auth, Guide, Demos, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-10
**Revised:** 2026-08-10 (a — initial draft, synthesized from the Clique P2
pilot evidence and a GPT-5.6-sol design consultation)
**Related:** LLP 0210 (asset DX closure — §D5 defines the grant machine this
Plan documents; Implemented), LLP 0044 (asset pipeline — §"Clique-pilot
delivery and grant DX closure" dated addition 2026-08-09), LLP 0053
(authorization-invalidation — §"The authorization-event universe (closed)"
constrains any TTL design), LLP 0011 (auth model — server-derived,
fail-closed authority), LLP 0056 / LLP 0208 G4 (memberships — the
app-bound-predicate rung deferred there), LLP 0201 (the benchmark that
produced the pilot), `benchmarks/records/2026-08-09-social-messenger-p2-pilot.md`
(pilot record, F5), `issues/closed/20260809-asset-recipient-grant-authority-g4.md`
(the design-commission ticket, closed on the D5(b) landing),
`issues/closed/20260809-asset-upload-dx-papercuts-g11.md` (recipe half),
`issues/20260809-s5d10-asset-grant-codes-unclassified.md` (open diagnostics
tail of the same landing)

## Summary

The Clique P2 pilot (LLP 0201, snapback lane) needed per-recipient media
authority — chat attachments visible to recipients, view-once — and no
declared `assetSharing` flavor fit. `ctx.assets.attach` refuses non-owner
callers (`SNAPBACK_ASSET_FORBIDDEN`), so the lane built ~80 lines of
hand-composed policy: per-recipient grant rows minted at send, authority
transferred by **patching the row's `viewerPrincipal` field** at open. It
worked — the 403 → 200 → 403 sequence survived hostile probes — but
authority-transfer-by-field-write mixed app state with security-critical
read authority, invalidation, GC protection, and revocation. The lane
scored the surface B5 = 62/100 ("policy-integrated storage exists but I
had to compose my own policy from its primitives"), and the pilot record's
F5 gap list carried it into the gap-closure program
(`issues/closed/20260809-asset-recipient-grant-authority-g4.md`).

**That gap is closed at the primitive level: the recipient-bindable grant
edge shipped on main after the pilot.** Commit `f706d11c8` ("feat(assets):
first-class recipient grants — LLP 0210 D5(b) landed", 2026-08-09) landed
the full machine on the local target, verified in-tree at draft time:

- **Admission-frozen opt-in** — `grants_enabled` on the admitted asset
  record (`src/assets.rs` ~796: "a later deploy cannot retrofit authority
  onto already-admitted bytes"); intent-side `grants: true` in
  `packages/snapback-codegen/define.mjs` (~3995, ~4047).
- **Handler ops** — `ctx.assets.grant` / `activate` / `revoke` host calls
  in `packages/snapback-harness/ctx-bootstrap.js` (~766), read-only-denied
  in queries.
- **Closed authorization machine** — owner-mint, named-principal-activate,
  owner-or-principal revoke, enforced transactionally in
  `src/storage/asset_grants.rs` (~80 onward, `@ref LLP 0210#d5`), staged
  as `asset_grant_ops` through commit in `src/runtime.rs` (~357).
- **Integration** — active-only read authority and GC protection, live
  revoke blanking, consistent-cut custody, typed refusals, 1,024
  pending-plus-active edges per app; covered by
  `asset_grant_ops_pilot_strict_signed_and_lifecycle` (`src/local/tests.rs`
  ~2781), `asset_grant_commit_wakes_and_revoke_blanks_live_projection`, and
  `asset_cut_carries_grants_at_the_same_consistent_cut` (~2151).
- **Docs** — `guide/backend/assets.md` §"Grant and revoke per-recipient
  access" (~627) already makes the grant-ops spelling primary with the
  app-owned-rows composition as the portable fallback, and the
  `backend.assets` capability row names grant ops, `view once` keywords,
  and the evidence set (local, **partial**; hosted is a nonclaim).

What remains is therefore *not* another asset authority abstraction. This
Plan scopes the closure tail: a dedicated recipe page generalizing the
pilot's view-once pattern onto the shipped primitive, capability-index
truth-keeping, an app-shaped acceptance-tested demo witness (no demo under
`demos/` uses `grants: true` today), and an explicit, author-visible
disposition of the one genuinely open design question — activation TTL.

## Options considered

From the design consultation, compressed; A/B/D are settled, C is the open
question.

- **A — documentation-only app grant rows** (the pilot pattern as the
  blessed spelling). Portable, filterable, zero platform machinery — but
  application fields become authority-bearing, and every app must
  reconstruct atomicity, invalidation, GC behavior, quota, and revocation.
  The pilot's ~80 lines are evidence this is a useful *escape hatch*, not
  default DX. Retained only as the portable fallback (already documented).
- **B — first-class grant edge + app-owned consumption state** (shipped).
  Owner pre-mints a pending grant; the named principal activates it at
  open; either party revokes. Snapback owns the security edge — read
  authority, invalidation, consistent-cut delivery, GC protection, quota —
  while the application defines what "viewed" means in its own consumption
  row. Costs: per-recipient fanout, the consumption row, and the honest
  gap that an activated grant stays active if the client crashes before
  close.
- **C — bounded activation lease (TTL)**. Extend B so activation
  establishes a server-time `activeUntil`, bounding the crashed-client
  exposure. But expiration-as-deauthorization collides with LLP 0053's
  **closed authorization-event universe** — wall-clock passage is
  deliberately not an authorization event, and v1 has no deadline
  scheduler — so TTL means a new authorization-event kind, persisted
  expiration state, an expiry runner, invalidation/GC receipts, and
  restart/race/signed-URL-lifetime semantics. Deferred behind an evidence
  gate (below).
- **D — first-class `viewOnce` / request-count consumption**. Superficially
  the best API; operationally ambiguous — range requests, retries,
  renditions, and parallel fetches mean "one HTTP request" is not "one
  human view," and no primitive retracts bytes already delivered. A
  declarative app-table-predicate variant would prematurely duplicate the
  membership-backed authority work owned by LLP 0056 / LLP 0208 G4.
  Rejected.

## Decision

**Owner-only `ctx.assets.attach` is affirmed as the right boundary.**
Attachment establishes an owner-controlled, GC-relevant typed reference —
it is an *integrity* operation. Letting a viewer attach would convert it
into an authority-escalation mechanism: any principal who could name an
asset could mint themselves a durable reference edge. The pilot's blocked
"viewer mints their own view-once grant" design was correctly refused; the
grant edge is the sanctioned spelling of recipient authority, and it keeps
authorization server-derived and fail-closed per LLP 0011.

Model B stands as shipped. The remaining work is documentation, index
truth, and witness — three deliverables below — plus the flagged TTL
question. Do not build C or D now.

## Design detail: the recipe this Plan pages

The recipe generalizes the pilot's working pattern onto the primitive
(semantics verified against `guide/backend/assets.md` §627 and the
enforcement in `src/storage/asset_grants.rs`):

1. **Send**: the owner attaches once, retains the typed reference on the
   message row (pending grants do **not** protect against GC — the
   reference does), mints one pending grant per recipient in the same
   mutation, and stores the opaque `grantId` in recipient-visible metadata.
2. **Open**: the recipient's authorized mutation atomically inserts a
   unique consumption row (e.g. `(messageId, principal)`) and activates
   that principal's grant. The consumption row is **product state** —
   grant activation alone does not prevent a second logical open during
   the active window.
3. **Close / delete**: revoke the grant (owner or named principal may).
   Revoke removes the edge; live projections blank on the same commit.
4. **Delivery**: the grant must be the recipient's **sole authority
   path** — use owner-only policy plus `private-strict` delivery for
   next-request denial; already-issued signed URLs survive until their
   bearer TTL. Prohibit durable client caching where the product claims
   view-once.

Stated limits, carried verbatim into the page: explicit close is not
crash-safe; `grants: true` is admission-frozen; 1,024 edges per app makes
large audiences a non-fit (that is the G4 membership program's territory);
view-once cannot prevent screen capture or byte retention after delivery;
the grant surface is claimed **local-only** — hosted targets must
capability-gate.

## Deliverables

- **D1 — Recipe page.** `guide/recipes/view-once-media.md` (working
  title): the send/open/close/delivery recipe above with CI-verified
  snippets, the consumption-row-is-product-state and sole-authority-path
  emphases, the crash-gap honesty note, and the app-owned-rows fallback
  cross-linked rather than duplicated from `guide/backend/assets.md`.
  *Proof:* `node scripts/check-guide.mjs` green; page frontmatter and
  snippet classes per `guide/conventions.md`.
- **D2 — Capability-index and diagnostics truth.** Keep the
  `backend.assets` row honest as D1/D3 land (doc-path addition for the
  recipe page; maturity stays `partial` until hosted is claimed or
  explicitly re-scoped), and close the open diagnostics tail: the eight
  D5(b) grant refusal codes are unclassified in the reviewed HTTP tables
  (`issues/20260809-s5d10-asset-grant-codes-unclassified.md`).
  *Proof:* `s5_d10_production_diagnostic_inventory_cannot_drift` green on
  main; capability row cites the new witnesses.
- **D3 — Acceptance-tested demo witness.** No `demos/*` app exercises
  `grants: true` today; the primitive's app-shaped proof lives only in
  `src/local/tests.rs`. Extend a messaging-shaped demo (e.g.
  `demos/team-chat` or `demos/messaging-snapback`) or add a minimal one
  with the full recipe, plus an acceptance test mirroring the pilot's
  hostile probes: non-recipient 403 → recipient open 200 → post-revoke
  403, and pending-confers-nothing. Land with a diary entry per repo
  convention. *Proof:* the demo's acceptance suite green in the local
  proof; diary records the DX delta against the pilot's ~80-line
  composition.

## Open questions

- **OQ1 (AUTHOR-VISIBLE) — Activation TTL.** Should activation carry a
  server-managed lease (`activeUntil`) so a crash between activate and
  revoke cannot leave authority active indefinitely? **Deferred until a
  crash/restart acceptance witness or a second application demonstrates
  that explicit close is inadequate** — the pilot's evidence proves the
  explicit 403 → 200 → 403 flow, not an abandoned-view requirement. TTL is
  not incremental: it adds a new authorization-event kind to LLP 0053's
  deliberately closed universe plus a scheduler/expiry contract (persisted
  state, restart behavior, invalidation and GC receipts, signed-URL
  interaction), and would amend LLP 0044/0210/0053 together. If the
  evidence arrives, build the lease — not request-count consumption (D).
- **OQ2 — Forwarding / delegated re-share.** Owner-only minting does not
  support recipient-initiated forwarding; a forwarding product would need
  an explicit granter policy. No current demand; record on first witness.
- **OQ3 — Hosted claim.** When the hosted asset lane matures, grants need
  their own hosted qualification before the capability row widens beyond
  `local`; until then applications capability-gate deployment targets.
