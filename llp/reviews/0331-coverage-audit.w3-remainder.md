**Artifact:** authorization coverage audit for LLP 0331 — slice `w3-remainder`
**Family / runtime:** Claude Fable 5 (orchestrator, this session); Claude Code, model `claude-fable-5`
**Date:** 2026-08-30
**Target:** `llp/0331-scoped-roles-diary-feedback.research.md`, uncommitted revision 2 (post-Codex-takeover), sha256 `3d6b2b95d00246f4c1ab7a212ef59a3266f473d6693ed9395b8b18c643a386aa` — specifically the §"Snapback2 synthesis" core model (lines 104–420)
**Brief:** `llp/reviews/0331-coverage-audit.brief.md` (the fixed extension codes X1–X20 and the per-app extraction format)
**Scope:** wave 3 — dating, DoorDash, daily fantasy, events, photos, tournaments (6 apps), completed by the orchestrator after the w3a/w3c cuts
**Status:** complete (targeted read, see the file's own method note)
**Method:** read-only audit of the verbatim paper-application artifacts under `llp/reviews/0329.014.00{1,2,3,5}-*` and the wave syntheses; every requirement is quoted with a `file:line`; verdicts use the brief's fixed codes so slices merge. This is a same-family research audit, not an LLP 0005 cross-family review; the merged result and its tiering are in LLP 0331 §"Coverage".
**Redacted:** no

---

# Authorization coverage audit — wave 3 remainder (dating, DoorDash, daily fantasy, events, photos, tournaments) vs the LLP 0331 core

Auditor: Claude Fable 5 (orchestrator), 2026-08-30, after the two subagent
slices covering these six apps were cut off by a session rate limit (their
completed halves are `0331-coverage-audit.w3a.md` and `.w3c.md`). Method: a
targeted read of each design's §1 product contract and §4 data model, the v0's
rule lines (grep over §2 schema), and the v0's §6–§8; not a line-by-line read
of every operation. Citations are `D:n` (design) / `V:n` (v0) file lines under
`llp/reviews/0329.014.003-wave-3.*`. Conventions follow the other slices:
several independent one-hop probes composed with `&&`/`||`/`!` are CORE; a
`where` on the found row may compare to the subject row's fields; global roles
are a scope-less relation table (CORE); time-bounded authority lowered to a
schedule-flipped status is CORE on the rule side and X11 on the runtime side.

---

## 1. Dating — wave 3 #2 (codex design, Fable v0)

**Principal shapes.** Member (`viewer`); safety staff as a global role table
(`staff = r => db.exists(staffRoles.byUserRole, [viewer, r])`, V:59); system
for five schedules (`activateTravel`/`expireTravel` V:95, `applyPairEvent`
V:105, `expireIntent` V:125, `buildRecommendations` V:150). No anon, guest,
service, or org principal.

| # | Requirement | Paper expression | Verdict | Note |
|---|---|---|---|---|
| 1 | Own account/profile readable and writable by self; safety staff read all; system flips safety state | `accounts.rules({ read: a => a.id === viewer \|\| sys() \|\| staff('safety'), … update: (o,a) => sys() \|\| staff('safety') \|\| (o.id === viewer && !sanctioned(o.status) && !sanctioned(a.status)) })` V:78–80 | CORE (+X11 for `sys()`) | `(old,next)` keeps a sanctioned member from un-sanctioning; staff is one hop on a scope-less role row. |
| 2 | A card is visible only if the other account is active, the pair is not separated (block/report/safety), and one of: open match, current recommendation item, paid incoming like | `cardVisible = u => u === viewer \|\| sys() \|\| staff('safety') \|\| (okAcct(u) && open(pairOf(u, viewer)) && (db.exists(matches.byPairOpen, [pairOf(u,viewer), true]) \|\| …))` V:69–72; `open = k => !db.exists(separations.byPairState, [k, 'active'])` V:62 | CORE(where) + CORE(neg), multi-probe | Every probe is one hop keyed by a row field, `viewer`, or the canonical pair key. `pairOf(a,b)` (V:58) is a pure shape function (the RFC's `orderedPair`); under 0331 either admit that shape function in key terms or store `lowUserId`/`highUserId` and key on the ordered pair (the design's `pair_state` already does, D:100). The negated separation probe is non-disclosing: block, report hold, and suspension are indistinguishable from "no card" (D contract 15, 17). |
| 3 | A like is private to its sender until reciprocated or the recipient holds a current paid entitlement; free members get no count, teaser, or refusal that reveals a liker | `directedIntents.read: i => i.actorId === viewer \|\| sys() \|\| staff('safety')` V:116; the paid disclosure is `readable: g => g.targetId === viewer && paid(viewer)` on a maintained row V:124, `paid = u => db.get(entitlementsCurrent.byUserFeature, [u, 'WHO_LIKED_YOU'])?.status === 'active'` V:63 | CORE + X14 (disclosure, not counted) | The authorization rule is owner-only; "who liked you" is a declared disclosure over a maintained aggregate (dimension F/J), exactly 0331's "authorization ≠ disclosure". `hasMore`/page-length as a paid-count oracle (V §6 L1) is a receipt/completeness item, not a rule. |
| 4 | A member may like/pass only against the pair's current generation, only while both accounts are active and the pair is open, and only if no match is open | `insert: i => i.actorId === viewer && i.pairKey === pairOf(i.actorId, i.targetId) && i.generation === gen(i.pairKey) && okAcct(viewer) && okAcct(i.targetId) && open(i.pairKey) && !db.exists(matches.byPairOpen, [i.pairKey, true])` V:119–120; `gen = k => db.get(pairGeneration, [k])?.value ?? 0` V:61 (a hidden maintained count, V:104) | CORE(where) multi-probe; `gen` as written is a count-in-rule (X17-shaped) | The generation fence reads a *maintained count row* as a rule input. Under 0331 store the generation on the pair row (the design has `pair_state.generation`, D:100) and probe it one hop: no count term needed. Droppable to core. |
| 5 | Messages readable/writable only by the two parties of an *open* match, at the current generation, while the pair is open | `messages.read: m => inMatch(conv(m.conversationId)?.matchId) \|\| sys() \|\| (staff('safety') && db.exists(reportEvidence.byObject, [m.id]))` V:141; `insert: m => m.senderId === viewer && inMatch(conv(m.conversationId)?.matchId) && m.generation === conv(m.conversationId)?.generation && open(conv(m.conversationId)?.pairKey)` V:142; `inMatch = mid => (db.get(matches, mid)?.lowUserId === viewer \|\| …) && db.get(matches, mid)?.open === true` V:66 | **CORE-with-denorm** (X1 as written) | Three hops as written: message → conversation → match. Denormalize `matchId`, `pairKey`, and `generation` onto `messages` (the v0 already carries `generation`, V:139, and `conversations` carries `matchId`/`pairKey`, V:137); then `inMatch(m.matchId)` and `open(m.pairKey)` are one hop each. Staff read of evidenced messages is a one-hop probe on `reportEvidence` — CORE. |
| 6 | Unmatching closes the conversation for both; a closed match is invisible; later matches need two fresh likes | `matches.read: … ((m.lowUserId === viewer \|\| m.highUserId === viewer) && m.open === true) // closed = invisible` V:131; `update: (o, m) => o.open === true && m.open === false && (party \|\| sys() \|\| staff)` V:136 | CORE via `(old,next)` | Revocation is the trace: the message rule's dependency on the match row cuts delivery at the closing commit (0331's mechanism verbatim). Hidden consumer history is retention (X14). |
| 7 | Blocks, reports, and safety holds: creator inserts/updates own block; staff or system for the rest; a block denies all new access immediately and purges pair data on the other device within ten minutes | `separations.rules({ read: s => (s.creatorId === viewer && s.source === 'block') \|\| sys() \|\| staff('safety'), insert: s => sys() \|\| staff('safety') \|\| (s.creatorId === viewer && s.state === 'active' && s.source !== 'safety'), … })` V:109–111; V §6 L2 `retain({ onDeny: 'purge', offlineLease: '10m' })` | CORE + X14 (lease) | Directional authority, symmetric visibility (contract 15) falls out of the negated probe in row 2. The ten-minute purge lease is retention policy under the store fence, not a rule. |
| 8 | Recommendations are built by the system over rows no member may read; items are hints, not grants | `recommendationItems.rules({ read: r => r.userId === viewer \|\| sys(), insert: r => sys(), … })` V:148; `schedule(buildRecommendations, { every: '8h', …, principal: 'system' })` V:150; D:112 "items are hints, not grants of continuing access" | X11 (schedule under a system principal, sealed reads) | Load-bearing: discovery is the product. The read side of the card (row 2) re-derives authority from the pair/entitlement rows at read time, so a stale item grants nothing — core. |
| 9 | Travel mode, like expiry (90 d), pass suppression (30 d), unmatch suppression (180 d), pair-event application run on schedules; rules stay time-free | `schedule(applyPairEvent, …, principal: 'system')` V:105; `schedule(expireIntent, { at: s => s.expiresAt, … })` V:125; V §6 "Not needed: … column-level visibility" | X11 (X6 weak — schedule-flipped state) | Every window is a status a schedule flips; the rule compares the status. No time term. |
| 10 | Notifications are re-checked as the recipient before dispatch; a block between commit and push withdraws it | V §6 L3 `notify(matches.insert, { to, revalidate: rule })` "evaluated *as the recipient* at dispatch" | X11-read (`evaluate as`) — droppable | In-app delivery already re-derives under the recipient's own rules (core); only push/mail bodies need the third-principal verdict (same as calendar C12). |

**App verdict — COVERED-WITH-DENORM + X11.** Authorization was *not* the hard
problem (the v0's findings are the `hasMore` cardinality oracle and the
retention lease, V §6 L1–L2); every who-may rule is an owner equality, a
one-hop probe, or a negated one-hop probe, and the design's own principle —
"authority is relational and temporal … every derived read rejoins the
authoritative pair, account, entitlement" (D:113) — is 0331's live-trace
recipe. The one denorm (messages carry `matchId`/`pairKey`) is an immutable
scope id. The design reached for a maintained count in a rule (`gen`, V:61,
104), which storing the generation on the pair row removes. The design did
not reach for anything RFC §8 refutes on the authorization axis; its
`visibility_epoch` (D:100) is the trace's job.

**Sprawl check.** X11 — load-bearing (recommendation build, expiry, pair-event
application; no human actor exists for them). X17-shaped `gen` — droppable
(store the generation). X11-read `evaluate as` — droppable for in-app; needed
only for push bodies. Nothing else.

---

## 2. DoorDash (three-sided delivery) — wave 3 #12 (codex design, grok v0)

**Principal shapes.** `principal.kind customer|restaurant_staff|dasher|support|service`
(D:149) — the v0 keeps one `viewer` and a scoped grant table:
`scoped_grant(principal_id, scope_kind, scope_id, role, valid_from, valid_to, revoked_at)`
(D:150) → `liveGrant(scopeKind, scopeId, role?)` (V §2). System for dispatch,
timeouts, settlement, payout, apply-result (V §6 #2 "eleven mutations are
client-callable holes"). Support is a time-bounded grant, i.e. a global role
row. The payment processor arrives through the effect kind (V §6 #5).

| # | Requirement | Paper expression | Verdict | Note |
|---|---|---|---|---|
| 1 | Restaurant staff act on a location only through a live, role-bearing grant; managers grant | `scopedGrants.rules({ read: g => g.principalId === viewer \|\| liveGrant(g.scopeKind, g.scopeId) \|\| sys(), insert: g => liveGrant(g.scopeKind, g.scopeId, 'manager') \|\| sys(), update: (old,next) => liveGrant(old.scopeKind, old.scopeId, 'manager') \|\| sys() })` V:131–135 | CORE(where) | 0331's `{scope, principal, role}` recipe verbatim, with `valid_from/valid_to` lowered to a schedule-flipped `live` status (V §7 "Status flags flipped by schedule"). |
| 2 | Hours, menus, overrides: public preview reads; live staff read; manager writes; system writes windows | `hours.rules({ read: r => public('hours-preview') \|\| liveGrant('location', r.locationId) \|\| sys(), insert: r => liveGrant('location', r.locationId, 'manager') \|\| sys() })` V:175–177; `openWindows … insert: _ => sys()` V:223–224 | CORE (+X11) | `public(reason)` disjoined with a probe (as auction A1). |
| 3 | Order readable by its customer, its restaurant's live staff, its active dasher, support; created by the customer; state transitions only by the actor the matrix names, from the legal predecessor | `orders.rules({ read: o => o.customerId === viewer \|\| liveGrant('location', o.locationId) \|\| …, insert: o => o.customerId === viewer \|\| sys(), update: (old,next) => sys() … })` V:374–384; transition matrix D:170–185 | CORE(where) + `(old,next)` (+X11 for system rows of the matrix) | Dasher clause is one hop on `assignments.byOrderActive [o.id, 'A'] where dasherId == viewer`. The matrix's system rows (acceptance-timeout, policy service) are X11. |
| 4 | One order, three purpose-built views: customer sees purchase/ETA/tracking/refund facts; restaurant sees prep/handoff; dasher sees route/pickup/delivery; customers never learn a batch-mate's identity or stop | D:5 (promise 1), D:31 (promise 14), D:187–197 field-grant table; V §6 #1 "A row that is readable is fully readable … engine-maintained projections with a declared audience"; V §7 "Three audience projections with visible versions" | **CORE-with-denorm** (X5 as the sugar) | The v0's own product change is three tables (`orderCustomerView`, `orderRestaurantView`, `orderDasherView`) written by the named programs at each transition — the protection-class split. X5 (RFC dimension O) only removes hand maintenance. |
| 5 | Order children (lines, amounts, private destination snapshot, revisions) follow the parent's audience | `orderLines.read: l => db.get(orders, l.orderId) !== null` V:405; `customerPrivate.read: p => db.get(orders, p.orderId)?.customerId === viewer` V:432; `restaurantRevisions.read: r => liveGrant('location', db.get(orders, r.orderId)!.locationId)` V:461; `dasherRevisions.read: r => db.get(assignments.byOrderActive, [r.orderId, 'A'])?.dasherId === viewer` V:474 | CORE(where) / **CORE-with-denorm** | Customer/dasher children are one hop on the parent with a `where`. The restaurant child is two hops (child → order → `locationId` → grant): copy `locationId` (immutable) onto every order child. The v0 did not. |
| 6 | Dispatch, offer expiry, acceptance timeout, settlement, payout, apply-result run with no human caller and must not be client-callable | V §6 #2 "`callable: 'system'`. Dispatch, settlement, payout, apply-result, freeze-round are client-callable" (load-bearing hole); D:9 (promise 3) "automated services may enforce deadlines" | **X11** (`callable:'system'` + schedule + effect ingress) | Load-bearing: the product's clock and money move on system actions. |
| 7 | Offer acceptance atomically wins the order, consumes dasher capacity, commits the batch route; an expired or lost offer cannot create duplicate pickup authority | D:27 (promise 12); V §7 "Live `assignments` `cap` 3"; `(old,next)` on the offer row | CORE `(old,next)` + `cap` constraint | Expiry is a schedule-flipped offer state (V §7 row "Status flags flipped by schedule … offer"). The v0's §8 #1 names the intent-clock trap (RFC §8 row "`ctx.now` for offers … → schedule-flipped state"). |
| 8 | Restaurant busy/closed windows gate intake; "closed" must bind every writer, not just `placeIntent` | V §8 #3 "Named-program derivation is not authorization: `placeWhileClosed` and `setBusyWeek` are admitted extra mutations"; V §7 "UTC `openWindows` + schedule `flipAccepting`" | CORE(where) on `acceptingIntake` (X6 weak; X11 schedule) | The insert rule probes the location row `where acceptingIntake == true`; the schedule flips it. No time term, and no program-name term needed. |
| 9 | Any signed-in customer may read menus/hours without `public` (world) | V §6 #11 "Authenticated-but-not-`public` read" | CORE | 0331 has no anonymous principal; "any authenticated" is the RFC's authenticated-not-public spelling (a literal `true` under auth-always-on, or `exists(customers,[viewer])`). |
| 10 | Support may cancel after pickup only for a safety/recovery exception; support grants are time-bounded | D:9, D:150 | CORE(where) | Global role row with a schedule-flipped `live` status. |

**App verdict — COVERED-WITH-DENORM + X11.** Authorization was one of the
design's named traps (trap 1, "a readable row is fully readable", D §3), and the
RFC's answer — projections with a declared audience — is sugar over the table
split the v0 itself adopted as its first product change. Every human rule is
the scoped-grant recipe or a one-hop parent probe; the one two-hop is fixed by
copying `locationId` onto order children. The load-bearing extension is X11 in
its `callable:'system'` form: the v0 counts eleven client-callable holes
without it. The design reached for `ctx.now` offer windows (RFC §8, fifth
hit) and for one row with field grants (RFC §8 "a readable row is fully
readable → projections"), both refuted in the RFC and both landing on core
shapes (schedule-flipped state; table split).

**Sprawl check.** X11 — load-bearing (dispatch/timeouts/settlement have no
actor; `callable:'system'` closes eleven holes). X5 — droppable: three hand-
maintained view tables. X1 — droppable by denorm (`locationId`). X3 kinds —
droppable: `principal.kind` never needs to appear in a rule; support/service
are rows or the system principal.

---

## 3. Daily fantasy — wave 3 #7 (codex design, grok v0)

**Principal shapes.** User (entries, wallets); feed adapters and lock/delay
operators as global role tables with capability bits (`isFeed = () =>
db.exists(feedAdapters.byUser, [viewer])`, `isLockOp = () => { const o =
db.get(operators.byUser, [viewer]); return o !== null && o.canLock }`,
V:116–118 — the v0's own answer to the design's "extra principal kinds"
ask, V §6 #6); system for lock transitions, scoring epochs, settlement, payout
(schedules and jobs). Public catalogs for anyone (`public('slate-lobby')`,
V:185).

| # | Requirement | Paper expression | Verdict | Note |
|---|---|---|---|---|
| 1 | Own entries, lineups, wallet, limits, devices: self-only reads/writes; system writes settlement | `entries.rules({ read: e => e.userId === viewer \|\| sys() …, insert: e => e.userId === viewer \|\| sys(), update: (o,n) => o.userId === viewer \|\| sys() })` V:339–345; `walletPostings … insert: sys` V:108 | CORE (+X11) | |
| 2 | Lineup children (slots, revisions, memberships) follow the entry's owner | `lineupSlots.read: s => db.get(entries, s.entryId).userId === viewer \|\| sys()` V:355; same shape V:371, V:392, V:407 | CORE(where) | One hop on the parent with a `where`. |
| 3 | Before lock only the owner sees selections; after a game locks, opponents may see selections from that game; unstarted selections stay hidden | D:27 (promise 13); V §7 "UNREVEALED = null point-get + public 9-slot template" | CORE(where) (X6 weak) | `read: s => owner \|\| exists(games, [s.gameId]) where state in ['LOCKED','IN_PROGRESS','FINAL','CERTIFIED']` — the lock is a status a schedule/operator flips (row 6), so the rule is time-free. The v0 refuses column-level rules for this (V §6 #13 "Not required"). |
| 4 | Contest seats/permits: only the system materializes seats; a viewer's claim must be coupled to a posting or it is a money hole | `contestSeats.update: (o,n) => sys() \|\| n.contestId === o.contestId, // viewer claim: coupling hole §5` V:308; V §6 #1 "Named-program write grants / cross-table coupling … table `writers: ['purchaseEntries', …]` or a `balancedAdmission` constraint … Without it I1 is a comment" | X19 (constraint class) — X20-W as the alternative | The *authority* part is core (any user may claim a free seat); the *money* part — a seat claim must be paid for in the same commit — is an event-coupled constraint (RFC §4 "event-coupled transitions"), not a who-may rule. The v0's `writers:` spelling is the program-scoped write grant. |
| 5 | Lock at `lock_at`, by server commit order, never by client clock; a locked game never silently reopens; an official delay may move an open lock | D:19–21 (promises 6–8); `games.update: (o,n) => (sys() \|\| isLockOp() \|\| isDelayOp()) …` V:203; V §8 #3 "three different mechanisms … only an `advanceGameLock` update OCC'd with `editLineup` on `games.id` is a real ordering" | CORE(where) + X11 (the closer) | Operators are global role rows with capability bits; `(old,next)` forbids LOCKED→OPEN. The lock *ordering* is OCC on the traced game row — 0331's rule-dependency trace does the serialization (as eBay). |
| 6 | Scoring epochs, leaderboards, settlement, payout run under system over frozen inputs; payouts credited exactly once | D §4 "ScoringEpoch … SettlementRun … PayoutInstruction"; V §6 #6 "`callable: 'system'` … repair/ingest/publish remain client-invocable husks"; #4 fenced bulk runtime | **X11** | Load-bearing: no human actor for any of it, and the ingest/publish programs must not be client-callable. |
| 7 | Responsible-gaming limits enforced across devices and concurrent requests without revealing them to other users | D:33 (promise 19); `limitUsage … read: r => r.userId === viewer \|\| sys()` V:108 | CORE (+ `cap({sum})` constraint) | Self-only rows; enforcement is a transaction-final sum constraint, not a rule. |
| 8 | Feed adapters ingest stats under a scoped credential | `isFeed()` V:116; V §6 #6 "extra principal kinds (`feed`, `operator`)" | CORE (global-role table) | The v0 spelled the kinds as rows; no `principal.kind` term is needed. |

**App verdict — COVERED-WITH-DENORM + X11 (X19 for the money coupling).**
Authorization was incidental (the design's traps are the 300k fan-out, exact
rank, and the lock ordering, D §3); every who-may rule is owner equality, a
one-hop parent probe, or a global-role row. The v0 turned the design's
"principal kinds" into role tables on its own. The one hole the v0 names as
load-bearing — a seat claim uncoupled from its posting (V §6 #1) — is an
integrity coupling of two writes in one commit (X19 / RFC event-coupled
transitions), which 0331 already routes to generic constraints, not to the
rule grammar. The design reached for `ctx.now() < lockAt` (RFC §8 "`ctx.now`
for offers, locks, deadlines", the fantasy hit) and the v0 corrected it to
schedule-flipped state plus OCC.

**Sprawl check.** X11 — load-bearing (lock closer, epochs, settlement,
payout, non-client-callable ingest). X19/X20-W — load-bearing for I1/I3 as a
*constraint*; droppable as a rule-locus feature. X3 kinds — droppable (rows).
X5 column-level — not required (V §6 #13).

---

## 4. Events (Doorlist) — wave 3 #3 (Fable design, grok v0)

**Principal shapes.** `principalKind ∈ {user, contact}` (D:216): a
pre-identity **contact principal** per phone/email (D:221–222), bound to a
user over time by `principalBindings` (D:223–227), so a user's effective
principals are a *set*; **access links** whose possession authorizes
guest-side acts for one contact on one event (D:228–231); hosts, co-hosts,
and door staff as `roleGrants { eventId, principalKind, principalId, role,
grants ⊆ {edit-details, manage-guests, view-contacts, check-in, send-updates,
manage-money, manage-roles} }` (D:252–257); system (promotion, refund
windows, sweeper, OTP completion, delivery callbacks, V §6 #10).

| # | Requirement | Paper expression | Verdict | Note |
|---|---|---|---|---|
| 1 | Co-hosts have exactly the powers the host granted, per event; removing a power applies to everything they do next | D:31–33 (P8); `roleGrants.rules({ read: g => sys() \|\| isStaff(g.eventId) \|\| (g.principalKind === 'user' && g.principalId === viewer), insert: g => sys() \|\| hasFlag(g.eventId, 'manageRoles'), update: … hasFlag(old.eventId, 'manageRoles') })` V:396–399; `hasFlag(eventId, flag)` probes the exploded grant row (V:103–107) | CORE(where) | The grants set is exploded into independent permission rows (V:93 "`grants[]` … are exploded") — 0331's "independent permissions use independent relationship rows". Revocation is the trace. |
| 2 | **A user holds an event grant, invitation, RSVP, or ticket through *any* contact principal currently bound to them** (P2: "When an invitee later signs up … their invitations, RSVPs, plus-ones, tickets and any co-host powers … become theirs, everywhere, without redoing anything") | D:21–24 (P2); D:226–227 `effectivePrincipals(user, t)`; V §6 #1 "Set-valued principal closure in rules … `existsAny(index, { principalIn: viewer.bindings })` … or (b) a `maintain.rows` / derived-table form"; V §8 #1 "every v0 rule is a point predicate over shape keys … unless a closure row exists" | **X3 (principal set) as stated — CORE-with-maintained-closure as shipped** | The v0's own product change: "Closure table `userAccess` written at bind/invite/grant \| Live principal-union in rules \| Claim is already an explicit act (I20, Op 2)" (V §7). `access = eventId => db.get(userAccess.byEventUser, [eventId, viewer])` (V:104) is then one hop. Under 0331 that closure table is *program-maintained* by the `bind`/`claim`/`invite`/`grant` programs (the identity kind's `claim` writes it) — an ordinary relation row, no rule-language change. The engine-maintained form (`maintain.rows`, X13) is the later sugar. The RFC's §8 row "rules are point predicates over one principal id → principal closure over a bounded binding set" was forced by this app. |
| 3 | An invitee without an account can see the event, RSVP, add plus-ones and get a QR code through a link, without installing anything (P1, "the ordinary first case") | D:14–17 (P1); D:228–231 `accessLinks … Possession authorizes guest-side acts for that contact on that event only; never a role grant`; V §6 #3 "Link-holder and anonymous principals … a runtime that binds link possession to `contact` **without** unlocking `roleGrants`"; V §7 "Link session is a contact principal, never a user" | **X4 (bearer) or X3 (contact principal minted at redemption)** | Load-bearing: the product's first case. Two bounded forms: (a) the RFC's `unique({bearer:true})` + `bearerOf`; (b) redeeming the link mints a session *for the contact principal* — then every rule is `exists(rsvps, [eventId, viewer])` with `viewer` the contact — 0331's guest-claim architecture ("preserve the same principal, attach a verified credential"). The v0 chose (b) in prose ("Link session is a contact principal"). Form (b) changes the identity boundary only; the rule grammar stays `{row, viewer}`. |
| 4 | Guest list visibility (everyone/guests/hosts) and detail (names/counts/none); a private attendee is never named; door staff see names and party sizes only; host-typed contact details only to `view-contacts` grantees (P3, P14, P15) | D:25–28, D:56–61; `invitations.read: i => sys() \|\| isManager(i.eventId)` V:440; `contactDetails.read: s => hasFlag(s.eventId, 'viewContacts') \|\| sys()` V:458; `rsvps.read: r => sys() \|\| isStaff(r.eventId) …` V:496; `listed` index for names (V §7) | CORE(where) + table split (X5 as sugar) | Field grants (`hostLabel`, address, `secretHash`) are separate tables (V §6 #2 "Splits work today; they are the T1 denormalization"). "Asking about someone you may not see gets the same answer as asking about someone who is not there" (P14) is 0331's no-oracle read. |
| 5 | Contact lookup inside `inviteOne` must find an existing contact by `(channel, address)` without making the table listable or world-readable | `contactPrincipals.read: _ => sys() \|\| true // **[inferred] footgun** — see §6.8` V:132; V §6 #8 "Authenticated point-get without `public` or world-`true` … `read: 'point'` … admitted only when the enclosing site is `get(unique)`" | X11-read (a viewer-invoked program reading a row the viewer may not list) | Same shape as calendar C8: the organizer writes a row it cannot read. Under 0331 the honest form is the sealed probe (`getHidden`, never returned, certificate-marked) or the RFC's site-conditioned rule. Load-bearing for P1's "invite anyone by phone or email" if contacts must be deduplicated across hosts; droppable by minting a fresh contact per host-event (loses cross-host identity until claim). |
| 6 | Waitlist promotion, offer deadlines, refund windows, check-in windows, the 180-day claim horizon run on schedules; a guest cannot write another party's RSVP | V §6 #13 "mutation-triggered `at: now` is the promote bus"; V §7 "Promotion runs after cancel, not in the guest tx \| Guest cannot write another party's rsvp"; V §8 #3 "clock predicates … `ctx.now` is bound at intent" | **X11** (schedule under a system principal; system writes another party's rows) | Load-bearing (P5, P10, P11). The same promotion-on-cancel shape as booking B10. |
| 7 | Every number shown is exact and the same number the host sees; "you're #3" | D:29–30 (P4); V §6 #4 `maintain.rank`; V §7 "Show `(seq, depth)`, never 'you are #3'" | X14 / completeness (not counted) | A rank over rows the guest may not name — RFC dimension A/K, a disclosure declaration, not a rule. |
| 8 | OTP completion, SMS/email delivery callbacks, and webhooks enter as system | V §6 #10 "Inbound host→`system` mutation and `callable:system`" | X11 (effect ingress) | |

**App verdict — NEEDS: X3 (principal set) → CORE-with-maintained-closure; X4 or
a contact principal at redemption; X11 (run + read).** Authorization *was* one
of this app's two hard problems (trap 1 "email is not permanent identity";
V §8 #1), and it is the app that forced the RFC's "principals are sets"
dimension. The finding for 0331 is that the v0 writer *already* reduced the
set-valued closure to a program-maintained relation row written at bind/claim
time — the same shape as 0331's scoped relation — and named live principal
union in rules as the thing it dodged. Two load-bearing needs remain outside
the rule grammar: a session for a link holder (identity layer) and the system
actor. The design reached for `effectivePrincipals(user, t)` as a live
function (V §8 #1, refuted by its own v0) and for clock predicates on
check-in/refund windows (V §8 #3; RFC §8 sixth hit).

**Sprawl check.** X3 sets — load-bearing as a *product*, droppable as a *rule
extension*: the closure table written by the claim program is core; the
engine-maintained form waits. X4/contact principal — load-bearing (P1);
choose the identity-layer form. X11 — load-bearing (P5, P10, P11). X11-read
(contact dedup) — droppable per-host. X13 — the later sugar for row 2.

---

## 5. Photos — wave 3 #9 (Fable design, grok v0)

**Principal shapes.** Owner via several devices (a device is "a phone uploader
with a revocable token, acting as the owner in the background", D:9); partner
(one other account); album member (dozens per album); **link viewer**
(anonymous token holder); system (derivation, schedulers, purge). Rules use
one `viewer`; the link is resolved by an effect (`shareLinks.read: l =>
l.ownerId === viewer \|\| sys(), // NOT public; resolve is an effect` V:477).

| # | Requirement | Paper expression | Verdict | Note |
|---|---|---|---|---|
| 1 | Everything in a library is owner-only; derived rows (labels, faces, clusters, search index) are system-written | `mediaItems.rules({ read: m => own(m.ownerId), insert: m => sys(), update: (o,n) => own(o.ownerId) && o.ownerId === n.ownerId && o.purgedAt === 0 })` V:249–252; `itemLabels … insert: sys` V:290 | CORE (+X11) | Owner partition = `ownerId` on every row (D:82). |
| 2 | Shared albums: owner and open members read; owner writes; members add items/comments/likes if the album allows; the owner can disable a link without evicting anyone who already joined | `albums.read: a => own(a.ownerId) \|\| db.exists(albumMembers.byAlbumUserOpen, [a.id, viewer, 1])` V:403; `albumMembers.rules({ read: m => m.userId === viewer \|\| m.ownerId === viewer \|\| sys(), … })` V:423–426; `comments.insert: c => db.exists(albumMembers.byAlbumUserOpen, [c.albumId, viewer, 1])` V:463; D:108 `albumMembers … joinedVia (invite \| link:linkId \| owner)` | CORE(where) | 0331's binary membership (`(album, user)` with an open-interval row). Link-joiners become ordinary members at join — the relation row is the authority, the link is not (P10). |
| 3 | Sharing never reveals person names, place names, or coordinates unless location is on for that album | D:55 (promise 12); `comments/albumItems … read: c => (db.get(albums, c.albumId)?.shareLocation === true) …` V:460; V §6 #6 "Column-level read rules (or required table-split diagnostic) … `E_RULE` rewrite 'split the secret columns'" | CORE(where) + table split | One hop on the album row with a `where`; the location columns live in a split table (the v0's own delta asks only for the *diagnostic*). |
| 4 | Partner sharing: one partner receives all photos, or photos of chosen people from a chosen date, automatically and continuously; either side can end it; removal takes effect within seconds | D:52 (promise 11), D:113–114 `partnerShareItems … Open row ⇔ the partner may see the item now`; `partnerShares.rules({ read: s => s.ownerId === viewer \|\| s.partnerUserId === viewer \|\| sys(), … })` V:547–549; V §7 "Evaluate partner rule at derive + explicit edits; hourly reconcile for the rest" | CORE-with-maintained-relation (X13 as the engine form) | The partner's authority is a *materialized derived relation* written by the derive job and by explicit edits — a program-maintained relationship table, core; `maintain.rows` is the later sugar. The v0 marks any *removal* that waits on the hourly reconcile a cheat (I7/T1). |
| 5 | Link viewers: anyone holding the token sees the album (view) or may join (join); the owner revokes | D:109 `shareLinks … tokenHash, permits (view \| join), revokedAt`; V:477 "resolve is an effect"; V §6 #7 "Anonymous capability principal (token holder) … host maps token → ephemeral principal with a capability row; or keep resolve as **effect** (this app)"; V §7 "Link view online-only, no live/retain" | X4 / X3(anon) — droppable to an effect-resolved ephemeral principal | The v0's chosen form is the identity-layer one: the host resolves the token to an ephemeral principal with a capability row, after which the album rule is one hop. Not a rule-language change. |
| 6 | Devices act as the owner with a revocable token | D:9; `devices.rules({ read: d => d.userId === viewer \|\| sys(), insert: d => d.userId === viewer, update: (o,n) => o.userId === viewer \|\| sys() })` V:156–159 | CORE (identity layer) | A device is a session/credential of the owner principal (0331: credentials are protected identity state); revocation = session revocation. No `ctx.device` term needed. |
| 7 | Derivation, reindex, partner reconcile, trash purge (60 d), account purge (30 d grace), export, memories run as jobs; nothing the user cannot see is revealed by counts, orderings, errors, or timing | D:104 `jobs … kind (derive \| reindex \| partnerReconcile \| purgeTrash \| accountPurge \| export \| memories)`; D:59 (promise 16) | X11 (jobs under a system principal) + X14 (owner-partition structural facts, V §6 #1) | Load-bearing. The completeness item is the RFC's dimension A second axis (photos was the third app to find it), not a rule. |

**App verdict — COVERED-WITH-DENORM + X11.** Authorization was incidental (the
design's axes are the owner-partition replica, the blob protocol, and
completeness); the sharing model is binary album membership, a one-hop
`where` on the album row for location, and a program-maintained partner
relation. The anonymous link viewer — the only actor without an account — is
handled by the v0 as an effect that mints an ephemeral principal, which keeps
every rule at `{row, viewer}`. The design reached for column-level rules
(V §6 #6, RFC §4 `E_SECRECY_MIX`) and landed on the split.

**Sprawl check.** X11 — load-bearing (jobs, purge, derivation). X4/X3(anon) —
droppable to the effect-resolved principal (the v0's path); loses nothing
stated. X13 — the later sugar for the partner relation; program-maintained is
core.

---

## 6. Tournaments (Matchlock) — wave 3 #14 (grok design, Fable v0)

**Principal shapes.** Organizer on an organization (`org_tos (org_id, user_id)
role owner|staff`, D:135), co-TOs granted per tournament (`tournamentTos`),
captains and members of entries (`entry_members … role captain|starter|
named_sub|playing_sub, valid_from, valid_to`, D:147), sponsors, spectators
(logged-out allowed — `public('published')`, V:65), a platform operator
(chargebacks/frozen payouts), system (round timers, payouts, transfers).

| # | Requirement | Paper expression | Verdict | Note |
|---|---|---|---|---|
| 1 | A TO is either granted on the tournament or an org TO of the tournament's org | `isTO = tid => db.exists(tournamentTos.byTournamentUser, [tid, viewer]) \|\| db.exists(orgTos.byOrgUser, [db.get(tournaments, tid).orgId, viewer]) // two-hop; cost reported, hoisted when tid is pinned` V:57 | **CORE-with-denorm** (X1 as written) | The org clause is two hops (row → tournament → `orgId` → orgTos). Copy `orgId` (immutable) onto every tournament-scoped row beside the `…tid` the v0 already carries; then both clauses are one hop. |
| 2 | Public tournament pages, brackets, standings, pool figures for anyone including logged-out; drafts only to TOs | `R.pubTO = { read: r => tPublic(r.tournamentId) \|\| isTO(r.tournamentId), insert: r => isTO(r.tournamentId), update: (o,n) => sysOrTO(o), delete: never }` V:63; `tPublic = tid => db.get(tournaments, tid).visibility !== 'draft'` V:60; `pubAppend … read: public('published')` V:65 | CORE(where) / `public(reason)` | Data-conditioned public read is a one-hop `where` on the tournament row. |
| 3 | Entry rows readable by members, TOs, anyone once in a generation or when the registrant list is published; a captain registers; members may edit non-authority fields; TO/system may disqualify | `entries.rules({ read: e => memberOf(e.id) \|\| isTO(e.tournamentId) \|\| e.inGeneration \|\| db.get(tournaments, e.tournamentId).registrantsPublic, insert: e => e.captainUserId === viewer && e.status === 'registered', update: (o,n) => sysOrTO(o) \|\| (memberOf(o.id) && n.captainUserId === o.captainUserId && n.inGeneration === o.inGeneration && n.status !== 'disqualified' && n.status !== 'no_show') })` V:89–90 | CORE(where) + `(old,next)` | `memberOf` is one hop on `entryMembers.byEntryUser` (V:58); roster substitution "never so that one user is active on two entries" (P14) is an `exclusion` over intervals (V §6 "Not a delta: … `exclusion` over intervals (invariant 20 exactly)"). |
| 4 | Check-in only inside the window, only by an active member or TO | `checkInEvents.insert: e => e.actorUserId === viewer && (activeMemberOf(e.entryId) \|\| isTO(e.tournamentId)) && db.get(tournaments, e.tournamentId).checkInState === 'open'` V:99 | CORE(where) (X6 weak) | `checkInState` is flipped by a schedule; V §6 "Not a delta: time (every window is a schedule-flipped flag and fits naturally)". |
| 5 | **Both entries must report the same score to confirm; a single report never crowns a winner; an opponent's report is invisible until you have reported or the window closed** | D:23 (promise 8); `matchReports.read: r => isTO(r.tournamentId) \|\| memberOf(r.reporterEntryId) \|\| (memberOf(r.opponentEntryId) && (db.exists(currentReports.byMatchEntry, [r.matchId, r.opponentEntryId]) \|\| db.get(matches, r.matchId).reportWindowClosed)) // invariant 12` V:126; V §6 #1 "two-party consensus must branch on a row the caller may not read … add `db.probeHidden(index, key)` usable in control flow and writes, never returned" | CORE(where) multi-probe for the *read*; **X11-read** (`getHidden`) for the *confirm* | The read rule is three independent one-hop probes. The confirm program must branch on the opponent's report, which the reporter may not read until after — the RFC's "hidden-versus-absent ambiguity … `probeHidden`" (tournaments row, RFC §2.1). Load-bearing for promise 8. |
| 6 | Confirmation fills downstream slots and standings for *other* entries immediately; spectators see confirmed state only | D:24 (promise 9); `standings.update: (o,n) => n.entryId === o.entryId && (sysOrTO(o) \|\| db.exists(entryMembers.byUserTournament, [viewer, o.tournamentId, true])) // coarse by necessity: a reporter's transaction updates opponents' rows, and the rule grammar cannot say "only as a consequence of a confirmed report"` V:138–139 | **X11** (system continuation) or X19 (event-coupled write) | The same "Bob's write updates Alice's row" shape as eBay row 5. Under 0331 the confirm program runs its downstream writes as a system continuation (`phase:'system'`) or the table declares an event-coupled transition. |
| 7 | Round timers pair Swiss rounds; payouts run only after placements are final; transfers are system-only | D:26 (promise 11), D:28 (promise 13); `payoutTransfers … .rules(R.append(sys))` V:164; `payoutLedger.update: (o,n) => sys()` V:163 | X11 | Load-bearing. |
| 8 | Anyone can contribute to the pool (anonymous allowed); a sponsor cancels only their own pledge while pledged; the TO edits pool terms only while open | `contributions.insert: c => (c.contributorUserId === viewer \|\| c.contributorUserId === '') && c.state === 'pending'` V:154; `sponsorPledges.update: (o,n) => sys() \|\| isTO(o.tournamentId) \|\| (o.sponsorUserId === viewer && o.state === 'pledged' && n.state === 'cancelled')` V:150 | CORE + `(old,next)` | Anonymous contribution = an authenticated viewer choosing not to be named, or the processor webhook as system (X11). |
| 9 | Unlisted tournaments: anyone with the link | V §6 #12 "bearer capability (wave-1 D) — v0 spellings are a side table and `public` without a listing index"; V §7 "`unlisted` = public rows without a listing index" | X4 — droppable | The v0's product change makes it `public` with no scan site; loses revocation of old readers on link rotation. |
| 10 | Spectator vs TO fields on one match row | V §6 #8 "Column audience on one row … forces hand-split tables and a program-maintained `displayEntryId`" | CORE-with-denorm (X5 as sugar) | Table split. |

**App verdict — COVERED-WITH-DENORM + X11 (run and read).** Authorization was
incidental (the design's hard problems are bracket generation, Swiss writes,
and the DAG cone); its actor model is three scoped relations (`orgTos`,
`tournamentTos`, `entryMembers`) probed one hop, with one two-hop the v0
itself flagged ("two-hop; cost reported") that an immutable `orgId` column
removes. The two things outside core are both the system actor: a confirm
that must branch on a row the reporter cannot read (the RFC's `probeHidden`,
forced by this app) and downstream writes to opponents' rows. The design
reached for nothing RFC §8 refutes on this axis; the v0 states outright that
time "is not a delta".

**Sprawl check.** X11 — load-bearing (timers, payouts, transfers; the
consensus probe; opponents' rows). X4 — droppable (public-without-listing).
X5 — droppable (split). X1 — droppable (denorm `orgId`).

---

## Slice rollup (six apps)

| App | Verdict | Load-bearing | Droppable / denorm |
|---|---|---|---|
| Dating | CWD + X11 | X11 (schedules, recommendation build) | `matchId`/`pairKey` onto messages; generation on the pair row; `evaluate as` for push only |
| DoorDash | CWD + X11 | X11 (`callable:'system'`, schedules, effect ingress) | three audience tables (X5 sugar); `locationId` onto order children; no kind term |
| Fantasy | CWD + X11 (+X19 constraint) | X11; X19 as an event-coupled *constraint* for the money coupling | kinds → role tables; column-level not required |
| Events | X3 sets → program-maintained closure (core); X4 or contact principal; X11 run+read | contact/link principal (identity layer); X11; the closure table | `existsAny` (later sugar over the closure table); X11-read contact dedup (per-host mint) |
| Photos | CWD + X11 | X11 (jobs, purge, derivation) | link viewer → effect-resolved ephemeral principal; partner relation program-maintained (X13 sugar) |
| Tournaments | CWD + X11 (run + `probeHidden`) | X11 incl. the sealed consensus probe and opponents' rows | `orgId` denorm; unlisted → public-without-listing; split |

**Reading.** In all six, the human who-may rules are 0331's recipe (scoped
relation rows, owner fields, one-hop `where` probes, negated probes, `(old,
next)`, `public(reason)`, global-role tables) plus denormalized immutable
scope ids; the only set-valued principal (events) was reduced by its own v0
writer to a program-maintained closure row, which is an ordinary relation.
What every one of them needs beyond the rule grammar is an *actor* that is
not a signed-in human: schedules and jobs, non-client-callable programs,
effect ingress, and — in events and tournaments — a viewer-invoked program
that must branch on or write a row the viewer cannot read. Bearer links
appear in four of six and are load-bearing only in events, where the
identity-layer form (a session for the contact principal) keeps the rule
grammar unchanged.
