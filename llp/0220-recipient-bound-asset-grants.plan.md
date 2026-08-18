# LLP 0220: Recipient-bound asset grants — recipes, guide coverage, and the activation-TTL question

**Type:** Plan
**Status:** Implemented
**Systems:** Assets, Auth, Guide, Demos, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-10
**Revised:** 2026-08-10 (Accepted → Implemented — D1/D2/D3 landed; see
"Implementation record (2026-08-10)". OQ1 (activation TTL) and OQ4
(owner-side revoke-all affordance) remain open by design and were
deliberately not built; OQ2/OQ3 unchanged.)
**Revised:** 2026-08-10 (Review → Accepted — accepted to begin implementation
(author direction in-session); final verdicts bind revision (c) with the (d)
tail unreviewed and disclosed; round-2 GPT family failed-to-review (three
runtime deaths, documented in the artifact) — the acceptance rests on the
Claude family's pre-existing-clean round 2 plus the dual-family round 1.
OQ4 added at acceptance: an owner-side "revoke all grants on an asset"
ergonomic affordance is recorded as a future option beside the app-side
grant-liveness bookkeeping the plan specifies — reviewer-confirmed that the
plan executes either way.)
**Revised:** 2026-08-10 (a — initial draft, synthesized from the Clique P2
pilot evidence and a GPT-5.6-sol design consultation); 2026-08-10 (b — Draft
→ Review at llp-super-refine loop start, the one authorized transition;
sub-orchestrated loop); 2026-08-10 (c — round 1 revision addressing both
round 1 reviews, dual NOT READY on rev b
(`llp/reviews/0220-recipient-bound-asset-grants.plan.{claude,gpt-5}.md`):
D1 now owns reconciling the stale assets.md §Anti-patterns bullet and dead
anchor; Option C/OQ1 recast TTL per LLP 0053's materialize-expiry-as-write
model (no new authorization-event kind); recipe distinguishes recipient
close from owner delete-for-everyone; D3 gains second-open-refusal and
two-recipient-delete probes; D2 code-list and maturity phrasing, delivery-
profile split, 1,024-ceiling scope, and witness citations tightened);
2026-08-10 (d — **UNREVIEWED** post-round-2 revision; round 2 = Claude
NOT READY with a single in-delta MATERIAL and pre-existing text CLEAN,
GPT family failed-to-review after three runtime failures (see
`llp/reviews/0220-recipient-bound-asset-grants.plan.gpt-5.md` §Round 2).
Fixes: recipient close now owns clearing its grant from owner-visible app
state so delete-for-everyone stays executable after partial closes, plus a
close-then-delete D3 probe; D3's second-open probe pinned to the
consumption-row refusal source; D1 rewords the surviving anti-pattern
bullet for both spellings; handler ops described as mutation-only; the
Option C dependency citation re-grounded on LLP 0044. Restored from the
sealed round-2 capsule after an external checkout revert, blob-verified)
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
`issues/closed/20260809-s5d10-asset-grant-codes-unclassified.md` (diagnostics
tail of the same landing; closed by D2)

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
the full machine on the local target, verified in-tree at draft time (the
commit identity comes from `git log` directly; no cited document records
it):

- **Admission-frozen opt-in** — `grants_enabled` on the admitted asset
  record (`crates/snapback/src/assets.rs` ~796: "a later deploy cannot retrofit authority
  onto already-admitted bytes"); intent-side `grants: true` in
  `packages/snapback-codegen/define.mjs` (~3995, ~4047).
- **Handler ops** — `ctx.assets.grant` / `activate` / `revoke` host calls
  in `packages/snapback-harness/ctx-bootstrap.js` (~766), mutation-only
  (denied in queries and actions alike).
- **Closed authorization machine** — owner-mint, named-principal-activate,
  owner-or-principal revoke, enforced transactionally in
  `crates/snapback/src/storage/asset_grants.rs` (~80 onward, `@ref LLP 0210#d5`), staged
  as `asset_grant_ops` through commit in `crates/snapback/src/runtime.rs` (~357).
- **Integration** — active-only read authority and GC protection, live
  revoke blanking, consistent-cut custody, typed refusals, 1,024
  pending-plus-active edges per app; covered by
  `asset_grant_ops_pilot_strict_signed_and_lifecycle` (`crates/snapback/src/local/tests.rs`
  ~2781), `asset_grant_commit_wakes_and_revoke_blanks_live_projection`
  (~4541), and `asset_cut_carries_grants_at_the_same_consistent_cut`
  (~2151).
- **Docs** — `guide/backend/assets.md` §"Grant and revoke per-recipient
  access" (~627) already makes the grant-ops spelling primary with the
  app-owned-rows composition as the portable fallback, and the
  `backend.assets` capability row names grant ops, `view once` keywords,
  and the evidence set (local, **partial**; hosted is a nonclaim). One
  stale tail remains: the same page's §Anti-patterns still carries a
  pre-landing bullet ("Do not call the designed grant operations yet …
  not a shipped API", ~1132) and a dead anchor to the since-renamed
  fallback section (~1128). D1 owns reconciling both.

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
  exposure. Under LLP 0053 wall-clock passage is deliberately not an
  authorization event: time-limited grants must **materialize expiry as a
  database write** (event 1), and v1 builds no deadline scheduler. TTL
  therefore needs *no new authorization-event kind* — grant identity and
  state are already captured dependencies (LLP 0044 §Asset read
  authorization, admitted under the framework LLP 0053 §Asset
  read-authorization inputs established), so an expiry-sweep write
  invalidates readers through the existing machinery —
  but it is still non-incremental: persisted deadline state, a
  scheduler/sweep contract (restart behavior, races with activate/revoke),
  expiry-write receipts and GC interaction, and signed-URL-lifetime
  semantics, in a runtime that deliberately has no deadline scheduler
  today. Deferred behind an evidence gate (below).
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
enforcement in `crates/snapback/src/storage/asset_grants.rs`):

1. **Send**: the owner attaches once, retains the typed reference on the
   message row (pending grants do **not** protect against GC — the
   reference does), mints one pending grant per recipient in the same
   mutation, and stores the opaque `grantId` in recipient-visible metadata.
2. **Open**: the recipient's authorized mutation atomically inserts a
   unique consumption row (e.g. `(messageId, principal)`) and activates
   that principal's grant. The consumption row is **product state** —
   grant activation alone does not prevent a second logical open during
   the active window.
3. **Close / delete**: two distinct verbs. *Recipient close* revokes that
   recipient's own grant (owner or named principal may revoke; revoke
   removes the edge and live projections blank on the same commit).
   *Owner delete-for-everyone* must revoke **every** outstanding grant on
   the message and remove the typed reference in the same mutation —
   `ctx.assets.revoke` takes one `grantId`, and independent grants
   provably survive a sibling's revoke (LLP 0210 §D5), so a
   single-edge delete leaves other recipients authorized. For
   delete-for-everyone to stay executable, *recipient close* must also
   clear that grant's id from the owner-visible app state (the same
   bookkeeping as the fallback recipe's delete-that-row step): a revoked
   `grantId` refuses as unknown and a staged refusal aborts the whole
   mutation, so delete-for-everyone must derive and revoke only
   still-live edges.
4. **Delivery**: the grant must be the recipient's **sole authority
   path** — use owner-only policy plus `private-strict` delivery for
   next-request denial. (Under the `private-signed` alternative, revoke
   stops new issuance but already-issued signed URLs survive until their
   bearer TTL.) Prohibit durable client caching where the product claims
   view-once.

Stated limits, carried verbatim into the page: explicit close is not
crash-safe; `grants: true` is admission-frozen; the 1,024-edge ceiling is a
**global per-app count** of outstanding pending-plus-active grants across
all assets (revoke releases capacity), not a per-message fanout budget, so
sustained large audiences are a non-fit (that is the G4 membership
program's territory);
view-once cannot prevent screen capture or byte retention after delivery;
the grant surface is claimed **local-only** — hosted targets must
capability-gate.

## Deliverables

- **D1 — Recipe page + guide reconciliation.** `guide/recipes/view-once-media.md`
  (working title): the send/open/close/delivery recipe above with
  CI-verified snippets, the consumption-row-is-product-state and
  sole-authority-path emphases, the crash-gap honesty note, and the
  app-owned-rows fallback cross-linked rather than duplicated from
  `guide/backend/assets.md`. D1 also reconciles that page's §Anti-patterns:
  remove the stale "Do not call the designed grant operations yet" bullet,
  repoint the dead `#compose-view-once-access-with-per-recipient-grant-rows`
  anchor at §"Portable fallback: app-owned grant rows", reword the
  surviving sole-authority anti-pattern bullet so it names the
  first-class grant edge alongside the fallback grant row, and verify no
  "not shipped" claim about grant ops remains anywhere on the page.
  *Proof:* `node scripts/check-guide.mjs` green; page frontmatter and
  snippet classes per `guide/conventions.md`; a grep witness that
  assets.md no longer calls the grant ops unshipped.
- **D2 — Capability-index and diagnostics truth.** Keep the
  `backend.assets` row honest as D1/D3 land (doc-path addition for the
  recipe page; maturity stays `partial` — any later promotion must resolve
  or explicitly re-scope every listed nonclaim, hosted included), and
  close the open diagnostics tail: the eight codes the D5(b) landing
  added are unclassified in the reviewed HTTP tables — seven
  `SNAPBACK_ASSET_GRANT*` / `SNAPBACK_ASSET_GRANTS_UNDECLARED` refusals
  plus `SNAPBACK_CTX_LEDGER_ID_KIND_MISMATCH`
  (`issues/20260809-s5d10-asset-grant-codes-unclassified.md`).
  *Proof:* `s5_d10_production_diagnostic_inventory_cannot_drift` green on
  main; capability row cites the new witnesses.
- **D3 — Acceptance-tested demo witness.** No `demos/*` app exercises
  `grants: true` today; the primitive's app-shaped proof lives only in
  `crates/snapback/src/local/tests.rs`. Extend a messaging-shaped demo (e.g.
  `demos/team-chat` or `demos/messaging-snapback`) or add a minimal one
  with the full recipe, plus an acceptance test mirroring the pilot's
  hostile probes and the recipe's load-bearing invariants: non-recipient
  403 → recipient open 200 → post-revoke 403; pending-confers-nothing; a
  second logical open — repeated *and* race-concurrent — refused by the
  unique consumption row, with the probe pinned to that refusal source
  (a bare re-activate refuses separately as
  `SNAPBACK_ASSET_GRANT_STATE_INVALID`, and a same-`clientKey` replay
  returns the original result — neither substitutes for the
  consumption-row check, so order the open mutation accordingly); a
  two-recipient owner delete-for-everyone that revokes both edges and the
  typed reference in one mutation, leaving neither recipient authorized;
  and close-then-delete — after one recipient closes, delete-for-everyone
  still succeeds, revoking only the still-live edge.
  Land with a diary entry per repo convention. *Proof:* the demo's
  acceptance suite green in the local proof; diary records the DX delta
  against the pilot's ~80-line composition.

## Implementation record (2026-08-10)

All three deliverables landed together (single program batch, this repo):

- **D1** — `guide/recipes/view-once-media.md` created (send/open/close-and-
  delete/delivery, consumption-row-is-product-state, sole-authority-path,
  crash-gap honesty, stated limits, fallback cross-linked); assets.md
  §Anti-patterns reconciled: the stale "Do not call the designed grant
  operations yet" bullet removed, the surviving sole-authority bullet
  rewritten to name both the first-class grant edge and the fallback grant
  row. Grep witness: `grep -n 'not a shipped\|designed grant' 
  guide/backend/assets.md` returns nothing. The dead
  `#compose-view-once-access-with-per-recipient-grant-rows` anchor named at
  acceptance had already been repointed on main before this program (the
  bullet's anchor now resolves to §"Portable fallback: app-owned grant
  rows"); D1 verified rather than re-fixed it. Proof:
  `node scripts/check-guide.mjs` green.
- **D2** — `backend.assets` capability row now cites the demo witness
  (`demos/messaging-snapback/tests/acceptance/headless.mjs`), llp/0220, and
  the recipe page (named in the description; the index's docs cell is
  mechanically single-page, so the page pointer rides the description and
  the recipe's own `capabilities:` claim). Maturity stays `partial`;
  nonclaims unchanged. The eight D5(b) codes were already classified on
  main (`f706d11c8` mapper, `4a2123340` reviewed tables); verified green at
  `79ac057b5` (`cargo test s5_d10`, 4/4 including
  `s5_d10_production_diagnostic_inventory_cannot_drift`) and the ticket
  closed with the optional gate-selection fix explicitly declined.
- **D3** — `demos/messaging-snapback` extended with the full recipe on the
  first-class primitive (viewOnceMessages + unique viewOnceConsumptions;
  sendViewOnce/openViewOnce/closeViewOnce/deleteViewOnceForEveryone;
  consumption-check-before-activate ordering; close clears the owner-visible
  grants map). Sessions-mode acceptance suite grew 11 → 18 checks, all the
  strengthened probes green: hostile 403 → 200 → 403, pending-confers-
  nothing, repeated **and** race-concurrent second open refused with
  `SNAPBACK_APP_REFUSAL`/`VIEW_ONCE_ALREADY_CONSUMED` (asserted not
  `SNAPBACK_ASSET_GRANT_STATE_INVALID`), two-recipient delete-for-everyone,
  close-then-delete via the liveness bookkeeping, non-recipient open and
  non-author delete refusals. Diary 0058 records the DX delta vs the
  pilot's ~80-line composition. The interactive Expo UI is deliberately
  unchanged (dev-mode personas cannot witness session-derived grant
  authority); the demo README documents this honestly.

One client-surface note discovered by D3 (does not contradict the Plan): a
declared refusal reaches the JS client as `diagnostic.code =
'SNAPBACK_APP_REFUSAL'` with `diagnostic.details.appCode`; the error object
carries no top-level `code` property.

## Open questions

- **OQ1 (AUTHOR-VISIBLE) — Activation TTL.** Should activation carry a
  server-managed lease (`activeUntil`) so a crash between activate and
  revoke cannot leave authority active indefinitely? **Deferred until a
  crash/restart acceptance witness or a second application demonstrates
  that explicit close is inadequate** — the pilot's evidence proves the
  explicit 403 → 200 → 403 flow, not an abandoned-view requirement. TTL is
  not incremental: per LLP 0053, expiry must materialize as a grant-state
  write (no new authorization-event kind — grant state is already a
  captured dependency), which means persisted deadline state plus a
  scheduler/expiry-sweep contract (restart behavior, races with
  activate/revoke, invalidation and GC receipts, signed-URL interaction)
  in a v1 that deliberately builds no deadline scheduler. It would amend
  LLP 0044/0210 — and LLP 0053 only if the eventual design left the
  materialize-as-write model. If the evidence arrives, build the lease —
  not request-count consumption (D).
- **OQ2 — Forwarding / delegated re-share.** Owner-only minting does not
  support recipient-initiated forwarding; a forwarding product would need
  an explicit granter policy. No current demand; record on first witness.
- **OQ3 — Hosted claim.** When the hosted asset lane matures, grants need
  their own hosted qualification before the capability row widens beyond
  `local`; until then applications capability-gate deployment targets.

- **OQ4 (added at acceptance):** should an owner-side "revoke all
  grants on an asset" affordance ship as an ergonomic complement to
  the app-side grant-liveness bookkeeping? Additive; evaluate after
  the D3 witness exercises the bookkeeping path.
