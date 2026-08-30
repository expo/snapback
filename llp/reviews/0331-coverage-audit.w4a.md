**Artifact:** authorization coverage audit for LLP 0331 — slice `w4a`
**Family / runtime:** Claude Fable 5 subagent (fresh context; general-purpose agent), launched by the orchestrator; Claude Code, model `claude-fable-5`
**Date:** 2026-08-30
**Target:** `llp/0331-scoped-roles-diary-feedback.research.md`, uncommitted revision 2 (post-Codex-takeover), sha256 `3d6b2b95d00246f4c1ab7a212ef59a3266f473d6693ed9395b8b18c643a386aa` — specifically the §"Snapback2 synthesis" core model (lines 104–420)
**Brief:** `llp/reviews/0331-coverage-audit.brief.md` (the fixed extension codes X1–X20 and the per-app extraction format)
**Scope:** wave 4 — offline bearer cash, E2EE messenger, spreadsheet, password vault (4 apps)
**Status:** complete
**Method:** read-only audit of the verbatim paper-application artifacts under `llp/reviews/0329.014.00{1,2,3,5}-*` and the wave syntheses; every requirement is quoted with a `file:line`; verdicts use the brief's fixed codes so slices merge. This is a same-family research audit, not an LLP 0005 cross-family review; the merged result and its tiering are in LLP 0331 §"Coverage".
**Redacted:** no

---

# Authorization coverage audit — Wave 4 (premise-breakers), first half

Slice: offline bearer cash, E2EE messenger, spreadsheet-as-database, password vault.
Tested against the LLP 0331 CORE model as stated in the brief. Wave 4 apps break
premises on purpose; every row below is tagged **S** (server-plane rule — what
core is for) or **D** (device-plane — X10, out of core's scope, not a core
failure). Line refs are `file:line` inside `llp/reviews/` unless a full path is
given.

Two cross-cutting observations first, because they recur in all four apps and are
not any single app's finding:

- **OBS-A — a `system` principal for schedules/jobs/continuations.** Every app
  here has a schedule or job that writes rows (cash sweeps and reclaims,
  messenger sweep/push expansion, spreadsheet midnight tick and feeds, vault
  delayed release and compaction). 0331 core says programs "derive the acting
  principal" from the session; a schedule has no session. The v0 writers all
  spell this `principal.kind === 'system'` / `principal: 'system'` /
  `callable: 'system'|'host'`. That is X11's "schedule under system principal"
  half. It is universal, and its smallest bounded form is one reserved
  `Principal` literal (`system`) admissible in rules and as the derived viewer
  of a schedule — no principal *kinds*.
- **OBS-B — two independent one-hop probes in one rule.** Core says "ONE
  bounded indexed relational probe". Several rules below need two *parallel*
  one-hop probes (`||` or `&&`), neither keyed by the other's result: messenger
  send (leaf entitlement `&&` group-head epoch), spreadsheet elevated authoring
  (rectangle grant `&&` workbook flag), cash report-stolen (own device `||`
  `mint_ops`). None is X1 (no chaining). If the 1001+ spec literally caps a rule
  at one probe, the smallest relaxation is "≤ k independent one-hop probes per
  rule, no probe key derived from a probe result" — a spec-wording question,
  not an extension. I mark these `CORE(where)×2`.

---

## 1. Offline bearer cash (Handnote)

**Wave 4 #1.** Design: `0329.014.005-wave-4.grok-cash.design.md` (grok).
Writing: `0329.014.005-wave-4.codex-cash.v0.md` (codex). Synthesis:
`llp/0329.014.005-paper-archetypes-wave-4.research.md:110`.

**Principal shapes.** Registered holder (`personId`, KYC tier); device with a
mint-signed certificate carrying a closed role enum
`consumer|merchant|transit|mint_ops` (design:107) and an `isActivePocket` flag;
merchant as an entity owned by a person (`merchantOwner`, v0:47); mint
operator/compliance (`mint_ops`, dual control); mint system principal
(schedules, settlement); bank partner as an external effect; peer devices as
off-server counterparties. The server sees person sessions (web, second
device) *and* cert-bound device calls (design:276 "that device's cert; mint
endpoint").

**Which scalar is `viewer`?** Under core the person is the principal; a device
is a row `deviceCertPrivate{deviceId, personId, isActivePocket}` (v0:42) and
"the caller controls device D" is one hop:
`exists(deviceCertPrivate.byDevice,[args.deviceId]) where personId == viewer`.
Possession of the device *key* is then either a login-identity binding in the
protected identity layer (provider = device cert, subject = devicePub) or a
signature check (X20). Nothing on the server plane needed `ctx.device` (X9)
once ownership is a row.

### Authorization requirements

| # | Requirement | Paper expression | Verdict | Note |
|---|---|---|---|---|
| S1 | Mint/redeem: caller is an active person, on an active pocket device they own, KYC sufficient for the amount, under today's velocity window | design:188 "**Auth:** active person, active pocket device certificate, KYC sufficient for `amountCents` plus today's `limitWindows(mint)`"; design:104 "Frozen people cannot mint, redeem, or settle incoming" | CORE(where) | Program reads: cert row for the named device (where `personId==viewer && isActivePocket && status=='active'`), `people` row (`status=='active'`, `kycTier` vs a literal threshold), and the `limitWindows` row keyed `(personId, yyyymmdd, kind)` (design:164) — a stored row, so the daily cap is a point read + compare, not an aggregate. The v0 prefers a time-bucketed `cap({sum, per})` constraint (v0:138) — that would be X17, but the design already denormalized the window into a row. |
| S2 | Registry/evidence tables are written only by the mint's settlement logic, never by staff or callers; `notes`, `consumption`, `doubleSpendEvidence` | v0:147 "Mint-only registry/evidence: `{read: system, insert: system, update: system, delete: never}`"; v0:196 `applyPartnerResult = mutation(/* callable:system … */)`; v0:243 "borrows … `callable:'host'`"; design:56 I23 "Mint support, refunds staff, and compliance cannot spend, move, or resurrect notes" | **X11** | Core binds a named program's writes to the *caller's* authority ("raw writes do not create a privileged escape lane"). Here the caller (a merchant till uploading its chain) must NOT be able to raw-insert a `consumption` row; the write is admitted only because the program verified the chain. That is program-owned (sealed) authority, not caller authority. |
| S3 | Settlement admits a `(noteId, fromVersion)` consumption only if the uploaded chain's signatures verify | design:26 promise 16 "the mint verifies signatures, conservation, uniqueness"; v0:226 `verifyBoundedSignedChain(a) // missing trusted crypto primitive`; v0:325 delta 5 "Ed25519 verify" | **X20** (verifySignature as a total builtin; RFC §2.2 D) | The admission criterion is *signed provenance*, which no probe over rows expresses. Not X4: the key is not unguessable-id possession, it is a signature over a chain. |
| S4 | Party evidence (`handoffs`) readable by the from/to bearer devices | v0:146 "Party evidence: `{read: bearerOf(from)\|\|bearerOf(to)\|\|system, …}`" | CORE-with-denorm | `bearerOf(from)` is the v0's spelling for "the device named by `fromDevicePub`". With viewer = person: `exists(deviceCertPrivate.byDevice,[row.fromDeviceId]) where personId==viewer \|\| exists(…,[row.toDeviceId]) where personId==viewer` — two parallel one-hop probes (OBS-B), or denormalize `fromPersonId/toPersonId` onto the handoff at settlement. The `\|\| system` arm is X11 (S2). |
| S5 | Receipts readable by the payer person and by the merchant's owner | design:141 receipts index `(payerPersonId, createdAt)`, `(payeeMerchantId, createdAt)`; v0:148 "Claims/day sheets: claimant or merchant owner reads" | CORE-with-denorm | `row.payerPersonId == viewer` (the design already denormalized person onto the receipt) `\|\| exists(merchantOwner.byMerchant,[row.payeeMerchantId]) where personId==viewer` (v0:47). |
| S6 | Report a device stolen: same person as the device, or mint ops | design:300 "**Auth:** same `personId` as the device, or mint ops" | CORE(where)×2 | `exists(deviceCertPrivate.byDevice,[row.deviceId]) where personId==viewer \|\| exists(deviceCerts.byPerson,[viewer]) where role=='mint_ops' && status=='active'`. `mint_ops` is a closed enum on the cert row (design:107) — a scoped role with scope = the mint. OBS-B. |
| S7 | Emergency extension needs two distinct operators | design:350 "**Auth:** `mint_ops` dual-control (two distinct ops personIds…)"; v0:264 "Two distinct authenticated calls append unique approvals; a system mutation requires two" | CORE | The v0's approval-table-plus-count form is X17. The two-slot form is core: `extension.update(old,next): next.approver2 == viewer && next.approver2 != old.approver1 && old.approver2 == null && <viewer is mint_ops>`; unique `(extensionId, approver)` (v0:134) is a core constraint. N-of-M would be X17; the design says two. |
| S8 | Guarantee claim: claimant is the settled holder of a void tip, or mint ops on their behalf; payout policy computed over hidden case/account rows | design:338 "**Auth:** claimant settled as holder of a void tip, or mint ops filing on their behalf"; v0:262 "a system continuation uses hidden data to write only `full\|half\|none`, payout, and clawback" | CORE(where) + **X11** | Filing: `exists(doubleSpendEvidence.byCase,[row.caseId]) where loserDeviceId == row.claimantDeviceId` plus device ownership — one hop each. Existence-oracle subtlety: `doubleSpendEvidence` is mint-only readable (v0:147); the probe returns only a boolean about the caller's own device, so no foreign existence leaks. The payout computation reads account balance and case rows the claimant cannot read — sealed continuation (X11, same as S2). |
| S9 | Refund window and cumulative cap adjudicated at settlement: `now ≤ refundUntil`; refunds ≤ `amountCents` | design:252 "**Auth:** … `now ≤ refundUntil`; person not frozen"; design:142 `refundedCents int (cache of sum of later refund sessions)`; v0:218 "`refundTotal` with declared receipt-party readability plus a sum-cap constraint" | CORE-with-denorm; window → **X6** droppable | Cap: the design stores `refundedCents` on the receipt, so `next.refundedCents <= old.amountCents` is an (old,next) rule; the v0's maintained-sum + sum-cap is X17 and unnecessary. Window: comparing `commitTime` to `refundUntil` needs a clock term core lacks (X6); droppable to a schedule-flipped `refundOpen` flag (RFC §8 "ctx.now for offers, locks, deadlines → schedule-flipped state"), which costs X11 (OBS-A). |
| S10 | One active pocket per person; MovePocket finalization | design:108 "At most one `isActivePocket=true` per `personId` among `status=active`"; v0:220 "Server finalization uses a partial unique active-pocket constraint" | CORE (constraint) | A *partial* unique (`where isActivePocket && status=='active'`) — core lists `unique`; whether it admits a `where` is a spec detail, and it is integrity, not authorization. |
| D1 | Spend authority offline = possession of the chain tip + a live device key; evaluated by the payee's device against gossip state | design:378 "Authorization is 'I hold the chain tip and a live device key.' … the commit that matters happens on a stall's phone"; design:224 "**Auth:** payer device cert valid and unrevoked in **payee's** last `trustBundle`; … payee accepts only if each note passes I10–I12 and I21–I22 against **payee** local state. Neither device asks the mint." | **X10** (out of core's scope) | The checks themselves are attribute compares (hop cap, expiry, cap) plus signature verification and bloom membership; the *site* is the device with no server. Core is not asked to express this and does not fail it. |
| D2 | ReadPocket: only that device reads its pocket | design:176 "**Auth:** the calling app is that device; no other person reads this pocket"; v0:149 "The apparent local rule `{read/insert/update: row.deviceId===viewer, delete:never}` does not solve `pocketNote`: the server remains authoritative. That table is unadmitted." | **X10** | Rule shape is core (`row.deviceId == viewer`); the table lives only on the device. |
| D3 | MovePocket between two devices of one person | design:264 "**Auth:** both certs `personId` equal, both unrevoked, `from` currently `isActivePocket` locally" | **X10** | Device-plane; the server's half is S10. |

### App verdict — server plane: **NEEDS: X11, X20**; device plane: X10 (out of scope)

Authorization was *incidental* here; the app's hard problem was authority
placement (custody moves rather than copies — synthesis :110). The server-plane
roster is simple ownership, one closed device-role enum, and a mint that must
be the only writer of its registry. X11 (sealed/program-owned authority for the
settlement writer, the sweeps, the claim continuation) is the single extension
that flips the server plane to COVERED; X20 (a signature-verify builtin) is the
admission criterion at settlement and is a runtime seam rather than a rule
shape. The design reached for a global unique on `handoffs (noteId, fromVersion)`
that the v0 refuted (v0:351 "The evidence schema contradicts the adjudication
rule"; RFC §2.2 C "conflict as evidence … `insertIfAbsent`") — an integrity
point, not authorization. The v0's `bearerOf` spelling (RFC §3
`principal.bearerOf`) is not needed once device ownership is a row.

### Sprawl check

- **X11** — load-bearing. Without program-owned writes, either staff principals can insert registry rows (breaks promise 12 "Staff cannot inflate serials", design:22) or the till that uploads its chain can raw-insert consumptions. No honest reduced product keeps promise 3 (detect-with-certainty) without it.
- **X20** — load-bearing for settlement (signatures are the chain); the reduced product without it is a server-authorized ledger ("Require mint connectivity for every spend", v0:340), which the design calls a cheat against promises 1–2.
- **X6** (refund window) — droppable: schedule-flipped flag; costs nothing the app lacks (it already has schedules).
- **X17** — not needed: dual control is two slots; refund cap and velocity are stored rows in the design's own schema.
- **X9** — not needed on the server plane: device ownership is a row; device-key possession is identity-layer or X20.

---

## 2. E2EE group messenger

**Wave 4 #4.** Design: `0329.014.005-wave-4.codex-e2ee.design.md` (codex).
Writing: `0329.014.005-wave-4.grok-e2ee.v0.md` (grok). Synthesis: `…wave-4.research.md:113`.

**Principal shapes.** Account (membership principal, closed role `admin|member`,
v0:166); device (cryptographic leaf and delivery principal — design:101
"Accounts are membership principals, but devices are distinct cryptographic
leaves and delivery principals"; the v0 makes the device the viewer, v0:56);
system (delivery worker, sweep, `phase:'system'` continuation); bearer-capability
holder for blobs; push provider and object store as effects; the operator sees
metadata only.

**Which scalar is `viewer`?** This is the app's central authorization question
and it is not device-plane. Per-device queues, per-device entitlement intervals,
and "a revoked device cannot authenticate" while sibling devices continue
(design:208, promise 9) require rules to know the *device*. With viewer =
account, device-scoped tables (`queues`, `controls`, `leaves`, `idempotency`,
`deviceRoutes`) cannot be bound. With viewer = device (the v0's choice), every
account-scoped rule (group membership, admin role, account sync) is two hops
(device → account → membership). The smallest bounded extension is **X9 in its
narrowest form: a second server-derived session scalar `ctx.device`**, used in
rules exactly like `viewer`, with device revocation handled by session
revocation in the protected identity layer (which 0331 already has). Rows
below are marked assuming that form; without it they are X1.

### Authorization requirements

| # | Requirement | Paper expression | Verdict | Note |
|---|---|---|---|---|
| S1 | Read an event only if this device held a leaf whose entitlement interval contains the event's sequence (historical entitlement, never recomputed from current membership) | v0:255–257 `read: e => any(leaves.byGroupDevice, [e.groupId, viewer], { take: 8, where: l => l.seqSpan.contains(e.groupSequence) })`; design:292 "Queue access is an immutable acceptance-time entitlement interval, not a check of current membership at fetch time" | CORE(where) (needs X9 for the device key) | One hop keyed `(group, device)`; the `where` is interval containment = two comparisons between the found row and the event row — core operators. The prefix matches ≤ 8 stint rows (rejoin); an `exists` over a small bounded prefix is one probe, not X17 counting. The drain query narrows this rule to `[entitlementStart, entitlementEnd]` (v0:626–635) — core allows narrowing. The *former-member retention* side is X14 (`retain delivered-history`, v0:253), not authorization. |
| S2 | Send only from an active, un-barriered leaf, only under the group's current epoch, only while the group is active | v0:258–261 `insert: e => e.senderDeviceId === viewer && any(leaves.byGroupDevice,[e.groupId, viewer],{take:1, where: l => l.endEpoch===0 && !l.barrier}) && db.get(groups, e.groupId)?.state === 'active' && db.get(groups, e.groupId)?.cryptoEpoch === e.epoch`; design:15 promise 4 "no post-removal event can be accepted under the old epoch" | CORE(where)×2 | Two parallel one-hop probes (OBS-B): leaf entitlement (relationship) and the group head (non-relationship row with a `where`, X7's CORE(where) case). The epoch equality is the atomic removal+rotation boundary expressed as a rule on every write (v0:732). Not X19: the group head is read, not written, by this rule; the transition program that bumps it is S3. |
| S3 | Membership transitions: an active admin adds/removes accounts; a member may add its own certified device; self-leave needs a different retained committer | design:180 "An active admin signs an account addition; an existing member account may authorize one of its certified devices without changing its role"; design:187 "A current admin may remove another member, while self-leave requires … a different retained device"; v0:498 `db.require(mine && (args.kind === 'leave' \|\| mine.role === 'admin' \|\| args.kind === 'add_device'), 'authz')` | CORE(where) with X9; else **X1** | With viewer = account: `memberships.update/insert: exists(memberships.byGroupAccount,[row.groupId, viewer]) where role=='admin' && endVersion==0`, plus `row.accountId == viewer` for self-leave / own-device add. The v0 left the table rule to the program (v0:187 "/* checked in program: actor is admin */") and ran the program `phase:'system'` (v0:490) — the RFC's X11 route; core would instead bind the relation table's own rules, which is exactly 0331's recipe (`memberAdd`, `memberRemove`, `memberLeave`). "Committer remains" (v0:520) is an (old,next)-style program check on the same transaction — core. Creator bootstrap (`createGroup`) is core's transaction-local creation provenance. |
| S4 | Roster/head reads: current members read the group head and the roster; a device reads its own leaf | v0:152–154 `read: g => any(memberships.byGroupAccount, [g.id, db.get(devices, viewer)?.accountId], { take: 8, where: m => true })`; v0:184–186 memberships read; v0:212–214 leaves read | CORE(where) with X9; else **X1** | The v0's `db.get(devices, viewer)?.accountId` inside the probe key is the device→account hop that X9 removes. `take: 8, where: m => true` on the group head admits *historical* members (so a removed device can still read the head to drain its queue) — a `where`-less bounded-prefix exists; core. |
| S5 | Attachment download by unguessable capability carried inside the ciphertext; the server never learns blob↔message↔group | design:201 "download requires the unguessable capability carried inside an authorized encrypted message"; v0:312–314 `.unique('byReadCap', ['readCapabilityHash'], { bearer: true })` / `read: b => … \|\| principal.bearerOf === b.readCapabilityHash`; design invariant 18 (:85) | **X4** | Core has no capability term; a membership probe would require the blob row to name its group, which invariant 18 forbids. |
| S6 | Revoking one device pauses every group whose current epoch still contains that leaf, atomically with the revoke (send barrier) | design:244 "(1) Atomically mark the device revoked … (2) detect every group whose current epoch still contains that leaf; (3) reject new application events in each affected group"; v0:689 "engine-propagated fan-out: `flag({ from: device.revoked, onto: leaves.barrier, along: byDeviceOpen })` … **or product boundary** `cap({ by: accountId, max: G })`" | **X13** (droppable to a product cap) | The send rule already reads `!l.barrier` (S2); the missing piece is *setting* `barrier` on an unbounded reverse index in the revoke commit. Alternative in core: rule S2 probes `devices` for "any leaf in this group is revoked" — that is a quantified two-hop, worse. With `cap({by: accountId, max: 100})` the revoke program sets ≤ 100 flags itself and the column is ordinary — CORE-with-denorm. |
| S7 | Delivery rows targeted at *other* devices (welcome/rekey packages) are inserted by the committer; push outbox and sweep rows are system-only | v0:300 `insert: c => principal.kind === 'system' \|\| /* committer targeting a retained leaf, checked in program */ true`; v0:304 "insert-for-others is E_STRUCTURAL_WRITE: only the system continuation may insert"; v0:360–365 pushOutbox all-effects `principal.kind === 'system'`; design:257 "A system-only scheduled worker" | CORE(where)×2 for `controls`; **X11** for schedules (OBS-A) | `controls.insert` is expressible without a system phase: `exists(epochTransitions.byId,[row.transitionId]) where committerDevice == ctx.device && exists(leaves.byGroupDevice,[row.groupId,row.deviceId]) where endEpoch==0` — the committer may address a retained leaf. Push/sweep are schedules — OBS-A. |
| S8 | Authenticated-but-not-public reads (key packages), public transparency log, account self-writes | v0:125 `read: p => p.status === 'live' && db.get(devices, viewer) !== null`; v0:141 `read: _ => public('device-roster transparency')`; v0:76–79 accounts rules | CORE / CORE(where) | "Authenticated" = one-hop probe on the viewer's own device/account row; `public(reason)` is core; status compare is a field term. |
| S9 | Server-side verification of signed admin intents, device certificates, and commits | design:61 invariant 6 "No membership change is accepted without … an intent signed by an account authorized"; v0:456 `// MISSING: verifySignature(…)`; v0:761 delta 2 | **X20** (droppable at the server) | The session already proves the account; the signature binds the transcript for *clients* (design:142 "public structure is verifiable"). Server-side refusal of forged commits before fan-out is stronger but not required by the stated promises. |
| D1 | Post-decrypt rules: sender role at that sequence, encrypted group policy, reaction/timer permissions, mention validity — evaluated by honest clients | design:111 "Honest clients must evaluate semantic rules after decryption, while the service enforces only membership, epoch, size, rate, and storage limits"; design:194, :222, :236; v0:42 "localDecrypt+validate — PV (rules over plaintext)" | **X10** (out of core's scope) | Stated by the design as a device responsibility; core is not asked to hold it. |

### App verdict — server plane: **NEEDS: X9 (narrow `ctx.device`), X4, X11, X13 (droppable), X20 (droppable)**; device plane: X10

Authorization *was* one of the app's hard problems on the metadata plane — the
synthesis says "the metadata plane is not the easy half" (:113) — but the hard
parts (historical entitlement intervals; atomic removal + epoch as a rule on
every send) fit core as a `where`'d one-hop probe once the device is a rule
term. The single extension that does the most is X9 in its narrowest form; with
it S1–S4 are core. X4 stands on its own because of invariant 18. The design
reached for a visibility-filtered drain that the RFC refuted: v0:621 "This is
the K2-class wrong answer … a former member can **starve**" → RFC §8 row
"ruling 2 (hidden take) on group logs | E2EE (third hit) | uniform-read logs
enter v0". Its authorization content (S1) is unchanged by that ruling; the
retention/drain shape is X14.

### Sprawl check

- **X9 (`ctx.device`)** — load-bearing: per-device queues and revocation of one device while siblings continue are promises 6, 9 and trap 2 (design:98–101). Reduced product without it: one queue per account, one shared cursor — the design names that a cheat.
- **X4** — load-bearing for attachments under invariant 18; droppable only by putting `groupId` on the blob row (then a CORE membership probe) at the cost of the server learning blob↔group.
- **X11** — schedules (OBS-A) load-bearing; the `phase:'system'` continuation for `controls` is droppable (S7 shows the core rule).
- **X13** — droppable to `cap({by: accountId})`; load-bearing only at the stated scale ("accounts in hundreds or thousands of groups", design:282).
- **X20** — droppable at the server; clients verify the transcript.
- **X1 / X3** — not needed if X9 is taken; the v0's "principals-as-sets; viewer is the device" (v0:771) is the heavier route.

---

## 3. Spreadsheet as the live database (Harbor)

**Wave 4 #7.** Design: `0329.014.005-wave-4.grok-spreadsheet.design.md` (grok).
Writing: `0329.014.005-wave-4.codex-spreadsheet.v0.md` (codex). Synthesis: `…wave-4.research.md:116`.

**Principal shapes.** `principal.kind enum(user, group, link, system)` (design:119);
org as tenant; workbook roles `owner|editor|commenter|viewer` plus flags
`can_share, can_author_elevated, can_edit_structure` (design:143);
rectangle-scoped grants with bits `can_read, can_write, can_elevated_write`
and a validity window (design:143); share-link as a `link` principal with a
token (design:147); system (RecalcDirty, feeds, midnight tick); a formula's
stored `authority_principal_id` — a principal that is *not* the viewer
(design:125, :109); feed operator; UDF sandbox "runs as system … with only its
arguments" (design:59).

### Authorization requirements

| # | Requirement | Paper expression | Verdict | Note |
|---|---|---|---|---|
| S1 | Workbook-level roles and permission flags gate structural ops, sharing, elevated authoring, UDF deploy | design:221 "Authorization: `can_edit_structure`"; design:304 "Authorization: `can_author_elevated`"; design:245 "Authorization: `can_share` or owner. Cannot grant elevated-write without being owner"; v0:64 `workbookPrincipal … Q[self\|H\|O, H\|O, H\|O, H\|O]` | CORE(where) | `exists(workbookPrincipal.byWorkbookPrincipal,[row.workbookId, viewer]) where canEditStructure` etc. The flags are a fixed set of boolean columns on the relation row — 0331's "independent permissions use independent relationship rows"; the enum is closed. Not X16 (vocabulary is not open at runtime). |
| S2 | Cell read/write authority = some unrevoked, in-window rectangle grant covering the cell with the right bit, or workbook owner | design:177 "`read_acl(principal, cell)` is true iff some unrevoked `range_acl` covers it with `can_read`, or workbook role is owner"; design:143 "Evaluation uses grants where `valid_from ≤ sequencer_now` and (`valid_to` is null or `> sequencer_now`) and `revoked_at` is null"; v0:38 "RC/WC/EWC … require v1.1 `any(...,{take:500,where:contains})`; strict v0 produces `E_RULE_UNBOUNDED`" | CORE(where) for containment; window → **X6** droppable | One hop keyed `(workbook, viewer, sheet)` with a `where` of four comparisons (`startRow<=row.rowIdx && … && canRead && active`) — core operators. The prefix may hold ≤ 500 grants (design:36 cap); an existential over a bounded prefix is one probe (cost, not expressiveness). The time window is a clock term core lacks; the v0 already replaced it with schedule-flipped `active` rows (v0:335 "Use schedule-flipped `active` rows and capped `any`") — CORE(where) + OBS-A. |
| S3 | Granting: the granter cannot grant read they do not have (new rectangle must be covered by the *union* of the granter's grants) | design:245 "Cannot grant read the granter does not have"; v0:338 `db.require(rect.coveredByUnion(viewer,args.rectangle),"ACL_ESCALATION") // [new]` | **X17/X20** (union coverage) — droppable | Coverage by a union of ≤ 500 rectangles is a quantified geometric predicate, not an existential. Reduction: require the new rectangle to lie inside ONE of the granter's grants → CORE(where); the product loses grants that straddle two of the granter's rectangles. |
| S4 | Elevated formula authoring needs both the cell-level `can_elevated_write` and the workbook `can_author_elevated` | design:197 "(and `can_elevated_write` + workbook `can_author_elevated` if `formula_class=elevated`)"; design:52 invariant 13 | CORE(where)×2 | Two parallel one-hop probes (OBS-B): rectangle grant with `canElevatedWrite`, workbook row with `canAuthorElevated`. |
| S5 | Feed-owned cells refuse user edits; feeds and their secrets are operator/owner-only; feed writes run as system | design:49 invariant 10 "Feed-owned cells are system literals. User edits there are refused"; design:269 "Authorization: system for `schedule`; `can_edit_structure` or feed operator for `manual`. Secrets never leave the server"; v0:181 `feed … Q[feed-operator\|E\|O\|S, …]`; v0:183 `feedOperator` | CORE + **X11** | `cellContent.update: WC && old.provenance != 'feed'` is an (old,next) rule; `feedOperator{feedId, principalId}` is an ordinary relation (v0:183). The scheduled fetch/apply runs as system — OBS-A. |
| S6 | RecalcDirty runs as system over the unfiltered workbook; user formulas are sandboxed to the *stored* `authority_principal_id` at eval time; elevated formulas read everything; the stored number is read by anyone who can read the cell | design:209 "Authorization: **system only**. Never as a user"; design:109 "stored computed values are unique per cell per calc run; user formulas are sandboxed by the author's principal at eval time; elevated formulas are sandboxed by workbook-full read; viewers may read the stored number iff they can read the cell"; design:51 invariant 12 "may read only cells that `authority_principal_id` can read **at eval time**"; v0:429 "ordinary rules bind the current viewer, not an arbitrary formula principal" | **X11** + **X20** ("evaluate the read rule *as* a named stored principal") — inside the `formulas` kind | The RFC placed the formulas kind outside the data plane (§2.2 "two evaluation classes now stand outside that plane"), so most of this is out of core's scope like X10. What core must *supply* is (i) the grant rows the engine consults (S2, core) and (ii) an entry point to evaluate a table's read rule for principal P ≠ viewer — the same shape as the vault's `db.evaluate(rule,{as})` but server-side. X11 covers the system-authority recalc and its sealed reads of rows the editor cannot read (design:79 "an elevated dashboard cell they *can* read must still update"). |
| S7 | Aggregates in a user formula over any unreadable precedent return `#PERM!`, never a filtered number; `#PERM!`, missing sheet, and typo collapse to `#REF!` for non-elevated principals; hidden sheets absent from the list; viewport must not reveal hidden occupancy | design:53 invariant 14; design:54 invariant 15; design:185 "Hidden sheets with no read grant: refuse as 'no such sheet'"; v0:477 "`ReadViewport` leaks hidden occupancy … emits `{access:"denied"}`, revealing which unreadable coordinates are populated" | CORE (disclosure posture) for tables; formula-side is the `formulas` kind | 0331's "reads compose policy into selection (no existence oracle)" and the RFC's structural-fact family (§5) cover the table side; the v0 fixed the viewport to emit denied for every *requested* key (v0:270). Inside formulas this is a negative-flow claim (v0:432 "Error collapsing: negative-flow runtime policy K") — X14-like disclosure, not a rule extension. Not counted. |
| S8 | Share links: token possession acts as a `link` principal with its own rectangle grant, expiring by a durable revoke job | design:147 "`share_link` — … maps to a `principal` of kind `link` with a range_acl, `expires_at` … Expiry is a durable revoke job (not clock-compared at read in a racy way)"; v0:164–167 `shareLink(… tokenHash … active, revokedAt)` | **X4/X3** — reducible to the identity layer | The rule side is core: the link principal has ordinary `rangeAcl` rows. What core lacks is minting a *session* from a bearer token for a principal nobody logged into — 0331 defers guest/anon principals. If token redemption is a login-identity kind (provider = share link, subject = token hash) in the protected identity layer, no rule-language change is needed. Expiry as a sweeper job is OBS-A. |
| S9 | Offline merge re-checks write authority as of merge time; revoked cells fail individually | design:293 "still has write on the cells **as of merge time** (ACL may have been revoked while offline: those ops fail individually with `#PERM!`)"; v0:350 `writeEachSoft` | CORE | Rules evaluated at commit with live revocation is core. Per-cell soft failure (`writeEachSoft`, v0:451) is a program shape, not an authorization term. |
| S10 | UDFs run as system with only their arguments; never inherit the invoker's grid reads or run as owner; feed-shaped UDFs use only operator-stored secrets | design:59 invariant 20; design:305 "Sandbox validator rejects network, filesystem, and grid handles unless `is_feed_shaped`" | **X8** (installed program isolation) — droppable | A tenant-installed program with a declared capability set is the RFC's `plugin` kind (dimension Q). Droppable: pure lambdas only, no JS UDFs. |
| S11 | Presence channel publish/subscribe gated by cell readability; snapshot export filtered by the requesting principal; disaster snapshot owner-only | v0:389 `presence = channel(...,{publish:canReadCell,subscribe:canReadCell,ttlMs:4000})`; design:317 "Authorization: `can_view` for export-of-what-I-can-see; owner for disaster snapshot"; design:165 "reads of a snapshot are ACL-filtered at read time with the requesting principal" | CORE(where) | Rule reuse on a channel and on `frozenSnapshotCell` (v0:228 `Q[RC,S,NVR,NVR]`). |

### App verdict — table rules: COVERED-with-denorm; **NEEDS: X11, X20 (evaluate-as, inside the formulas kind), X6 (droppable), X17/X20 (droppable), X4/X3 (identity-layer), X8 (droppable)**

Authorization *was* a hard problem here — two of the six traps are
authorization (trap 3 "visibility-filtered aggregates", trap 6 "who a formula
acts as", design:81, :105) — but the hard part sits inside the `formulas`
evaluation class, which the RFC put outside the server data plane. The table
rules themselves are core: rectangle grants are a `where` of comparisons, roles
and flags are a closed relation row. The single extension that matters for the
data plane is X11 (system recalc that reads what the editor cannot); the
`evaluate-as-stored-principal` need (S6) is the one genuinely new rule-shape,
and it belongs to the kind, not to table policy. The design compared
`valid_from ≤ sequencer_now` in ACL evaluation (design:143); the v0 replaced it
with schedule-flipped rows (v0:335), matching RFC §8 "ctx.now … → schedule-flipped
state". The design's `#PERM!`-not-partial-sum rule (invariant 14) is the RFC's
structural-fact ruling (§5) stated independently — the design got it right.

### Sprawl check

- **X11** — load-bearing: RecalcDirty must read cells the editor cannot (design:79) and write computed cells nobody may write (design:40 invariant 1). No reduced product keeps "dashboard total of salaries without reading salaries" without it.
- **X20 (evaluate-as)** — load-bearing for promise 12 (user vs elevated formula classes, design:30); the reduced product "Remove elevated formulas" (v0:464) is acceptable only for "personal or uniformly shared workbooks".
- **X6** — droppable: schedule-flipped `active`.
- **X17/X20 (union coverage)** — droppable: single-grant containment on grant.
- **X4/X3 (links)** — droppable: registered principals only; otherwise an identity-layer kind, not a rule term.
- **X8** — droppable: no sandboxed UDFs.

---

## 4. Password vault (1Password-class)

**Wave 4 #2.** Design: `0329.014.005-wave-4.codex-vault.design.md` (codex).
Writing: `0329.014.005-wave-4.fable-vault.v0.md` (Fable). Synthesis: `…wave-4.research.md:111`.

**Principal shapes.** Server plane: account shell with members and an admin role
(v0:52); device as the transport principal (v0:53 "transport principals are
devices"); route-token bearer (v0:54); system (schedule, GC, compaction);
delegate and owner mailboxes for delayed release. Device plane (encrypted):
`principal_id, kind: person/group/team/trustee` (design:96); device certificates
(non-expiring, revoked by governance commits, design:98); item rights
`read, edit, share, delete, admin` (design:102); trustee quorums; a travel
identity as a distinct `device_id` (design:114).

The v0's own statement of the boundary (v0:71): the server "can evaluate (i)
transport rules: mailbox grants and route-token possession; (ii)
plaintext-column constraints … (iii) time witnessing … It cannot evaluate any
item-level rule — read, edit, share, delete, admin — … because none of those is
a column." That is the S/D split; every item-level requirement is D.

### Authorization requirements

| # | Requirement | Paper expression | Verdict | Note |
|---|---|---|---|---|
| S1 | Account shell: members read; sign-up inserts; admins update; quota/usage admin-readable | v0:52 "`accounts { id, tier, quotaBytes }` — read: member; insert: authenticated('signup'); update: admin. `accountMembers { accountId, userId, role }`"; v0:66 `maintain.sum(blobs, … readable: b => isAccountAdmin(b.accountId))` | CORE | 0331's scoped-role recipe verbatim. The `readable` on the aggregate is X14 (disclosure), not counted. |
| S2 | Mailbox reads by grant; deliveries readable by the mailbox's grantee | v0:53 "`mailboxGrants { mailboxId, principalId }` — transport principals are devices"; v0:64 "read: mailbox grant" | CORE (per-device isolation would need X9) | `exists(mailboxGrants.byMailboxPrincipal,[row.toMailboxId, viewer])`. If the viewer is the account, every device of the account can read every device-kind mailbox of that account; the design's real exclusion boundary is cryptographic (promise 15, design:21 "cannot … stop an isolated device from using its old replica"), so server-side per-device isolation is not load-bearing — noted, not counted. |
| S3 | Delivering into a mailbox requires possession of its opaque route token | v0:54 "`routeTokens { token: id() unique bearer (v1: possession is the rule input), mailboxId }` — opaque delivery capability; read: never"; v0:64 "insert: route-token possession"; design:113 "opaque route or mailbox token" | **X4** — droppable | Reduction: a `mailboxSenders{mailboxId, principal}` relation → CORE. Cost: the server learns who may send to whom — but it already observes who uploads to which mailbox (design:23 promise 7 concedes "opaque mailbox identifiers, traffic timing … upload/fetch activity"), so the relation leaks nothing new. |
| S4 | Blob read only by a principal it was delivered to; insert by an account member; delete system-only; GC by one-use capability | v0:58 `.rules({ read: b => db.exists(deliveries.byBlobPrincipal, [b.id, viewer]), insert: b => isAccountMember(b.accountId), update: never, delete: b => principal.kind === 'system' })`; v0:17 "forgetBlob (GC capability) … one-use capability v1"; v0:108 "one `deliveries` row per recipient" | CORE-with-denorm (read/insert); **X11** (delete); **X4** (GC) | Read is one hop only because the v0 writes one delivery row per recipient carrying the principal (the design's fan-out cap of 256, design:3 of v0). Without that denorm it is blob → delivery → mailbox grant (X1). The GC capability is how *device-plane* delete authority is projected onto a server that cannot evaluate `delete` (v0:71): droppable if only the uploader's account may purge. |
| S5 | Delayed emergency release: owner may veto while waiting; system flips to released after the window; delegate redeems a bearer release token | v0:68 "`releaseRequests { … status: enum(waiting → vetoed \| released) }` — owner sets vetoed, system sets released"; v0:112 "`schedule(releaseAfterVeto, { at: r => r.requestedAt + r.vetoMs, key: r => r.id, principal: 'system' })` flipping status"; v0:19 "redeemReleaseToken … bearer unique" | CORE (veto); **X11** (schedule, OBS-A); **X4** (token, droppable) | Veto: `update(old,next): old.status=='waiting' && next.status=='vetoed' && exists(mailboxGrants…,[old.ownerMailboxId, viewer])`. The v0 notes the schedule *is* invariant 17's "named trusted time witness" (v0:112). Token droppable to "delegate mailbox grantee reads the released row". |
| S6 | Rate limits, quota caps, append-only, content-address check on upload | v0:59–60 `cap({ sum: 'paddedLen', by: 'accountId', maxFrom: accounts.quotaBytes })`, `rateLimit({ by: viewer, per: '1m', max: 600 })` | constraints, not authorization | Time-bucketed caps are X17-shaped constraints; noted, not counted as rule extensions. |
| S7 | Server compaction and checkpoint receipts | v0:22 "serverCompaction … job v1"; v0:18 `recordCheckpointReceipt` plan | **X11** (job); CORE (receipt by mailbox grant) | OBS-A. |
| D1 | Item rights (`read/edit/share/delete/admin`) resolved through the viewer's group/team/trustee bindings against a policy DAG the device verified | v0:104 "`hasRight(item, right)` is `existsAny(effectivePolicy.byItemSubjectRight, { principalIn: viewer.bindings, key: [item, right] })` **(v1 N)**"; design:8 promise 8 "vault roles and groups are conveniences that devices expand into cryptographic capabilities" | **X10** (out of scope); inside it X3 (bindings) — reducible | On the device, group grants could be expanded into per-principal `effectivePolicy` rows (the design already says devices "expand" them), making the probe a core one-hop. Rights are independent bits, not a lattice — core-shaped. |
| D2 | Accepted writes are signed by a device holding `edit` under the policy head *the revision names*, evaluated for *the author*, not the current viewer | design:34 invariant 5 "Every accepted mutation is signed by a device with the required capability under the policy head referenced by that mutation"; v0:94 `insert: r => r.authorDeviceId === principal.device && r.authorPrincipalId === viewer && hasRight(r.itemId, 'edit')`; v0:128 `db.evaluate(revisions.rules.insert, { as: r.authorPrincipalId, asOf: r.policyHead, row: r }) // §6 #3 — does not exist` | **X10** (the brief's exact spelling) | Out of core's scope. Note the device-plane rule uses `principal.device` (X9) and `viewer` together — the same account/device duality as the messenger, but here entirely on the device. |
| D3 | Grants need `share`; team governance may require an owner quorum; policy merges must not broaden by union; removal beats concurrent grant | design:170 "**Authorization:** `share` capability; applicable team governance may additionally require an owner quorum"; design:37 invariant 8; v0:234 §8 #1 "A concurrently removed grantor's grants merge in" | **X10**; inside it X17 (quorum) | Device plane. The security finding (synthesis :216) is a device-plane policy-merge bug, not a server rule. |
| D4 | Unlock/read/autofill authority = possession of the device keyring; offline authority never expires by silence | design:130 "**Authorization:** Possession of the device and its protected keyring"; design:32 invariant 3 | **X10** | Out of scope; the server holds no item row to gate. |

### App verdict — server plane: **COVERED-with-denorm modulo X11 (schedules/jobs/GC) and X4 (three bearer tokens, each droppable)**; device plane: X10

Authorization was *the* hard problem of the vault — and the design placed all of
it on the device by construction (design:295 "Authorization is encrypted
application data … only endpoints can decide"). What is left on the server is
transport authorization: account membership, mailbox grants, delivered-to
reads — 0331's recipe with one denorm (a delivery row per recipient). No single
extension flips it because nothing rule-shaped is missing; X11 is OBS-A. The
design's delayed emergency access as elapsed time (design:18 promise 18,
:46 invariant 17) was written by the v0 as a schedule under a system principal
(v0:112) — RFC §8 "`ctx.now` for offers, locks, deadlines → schedule-flipped
state"; the design's own "named trusted time witness" language anticipated it.
The RFC's `db.evaluate(rule,{as,asOf})` (§2.2 premise 3) came from this app's
D2 and is X10 by definition.

### Sprawl check

- **X11** — load-bearing for the delayed-release schedule (the only server-side time witness the product has) and GC/compaction jobs; not user authorization.
- **X4 (route tokens)** — droppable to a sender-grant relation with no new metadata leak.
- **X4 (GC capability)** — droppable if purge is restricted to the uploader's account; load-bearing for "any device with `delete` may purge" since the server cannot evaluate `delete`.
- **X4 (release token)** — droppable to a mailbox-grant read of the released row.
- **X9** — not needed on the server plane (cryptographic exclusion is the real boundary); appears inside the device plane as `principal.device`.
- **X3 / X17** — device-plane only; X3 reducible there by expanding group grants into rows.

---

## Slice rollup

| Code | Apps (server plane) | Load-bearing where | Droppable where |
|---|---|---|---|
| X11 | 4/4 (cash, E2EE, spreadsheet, vault) | cash (mint-only registry writes, sealed claim continuation), spreadsheet (system recalc reading what the editor cannot); schedules everywhere (OBS-A) | E2EE `phase:'system'` for `controls` (a core rule exists) |
| X4 | 3/4 (E2EE, spreadsheet, vault) | E2EE blobs (invariant 18) | vault ×3 (relations), spreadsheet links (identity-layer kind) |
| X20 | 3/4 (cash, E2EE, spreadsheet) | cash (signed provenance is the admission criterion); spreadsheet (evaluate-as stored principal — inside the formulas kind) | E2EE (clients verify) |
| X9 | 1/4 (E2EE) | E2EE (per-device queues/revocation) | cash, vault (device ownership is a row; crypto is the boundary) |
| X13 | 1/4 (E2EE) | at stated scale (thousands of groups) | with `cap({by: accountId})` |
| X6 | 2/4 (cash, spreadsheet) | — | both (schedule-flipped state) |
| X17 | 1/4 (spreadsheet: union coverage) | — | single-grant containment; cash dual-control and caps are two-slot / stored rows |
| X8 | 1/4 (spreadsheet UDFs) | — | no sandboxed UDFs |
| X3 | 0/4 server; device-plane in vault | — | expand bindings into rows |
| X1 | 0/4 if X9 taken; else E2EE ×2 | — | X9 is the smaller fix |
| X10 | 4/4 device plane (cash, E2EE, spreadsheet's formulas kind by analogy, vault) | out of core's scope by the brief's own rule | — |
| X14 | noted in E2EE (delivered-history), spreadsheet (`#PERM!`/`#REF!` collapse), vault (`readable` on usage) | not authorization | — |

Nothing in this slice needed X2 (hierarchy), X5 (audience projection), X12,
X15 (lattice), X16 (roles as data), X18, or X19. Every role enum was closed and
small (`admin|member`; `consumer|merchant|transit|mint_ops`;
`owner|editor|commenter|viewer` + flags; `read/edit/share/delete/admin` as
independent bits), and no app asked for role comparison.
