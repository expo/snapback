**Artifact:** authorization coverage audit for LLP 0331 — slice `w2b`
**Family / runtime:** Claude Fable 5 subagent (fresh context; general-purpose agent), launched by the orchestrator; Claude Code, model `claude-fable-5`
**Date:** 2026-08-30
**Target:** `llp/0331-scoped-roles-diary-feedback.research.md`, uncommitted revision 2 (post-Codex-takeover), sha256 `3d6b2b95d00246f4c1ab7a212ef59a3266f473d6693ed9395b8b18c643a386aa` — specifically the §"Snapback2 synthesis" core model (lines 104–420)
**Brief:** `llp/reviews/0331-coverage-audit.brief.md` (the fixed extension codes X1–X20 and the per-app extraction format)
**Scope:** wave 2 — semantic search, editor, graph, realtime (4 apps)
**Status:** complete
**Method:** read-only audit of the verbatim paper-application artifacts under `llp/reviews/0329.014.00{1,2,3,5}-*` and the wave syntheses; every requirement is quoted with a `file:line`; verdicts use the brief's fixed codes so slices merge. This is a same-family research audit, not an LLP 0005 cross-family review; the merged result and its tiering are in LLP 0331 §"Coverage".
**Redacted:** no

---

# Authorization coverage audit — LLP 0331 core vs. wave 2, second half

Slice: semantic search, collaborative editor, graph, realtime. Two artifacts each
under `/Users/ccheever/projects/snapback/llp/reviews/`, plus the wave synthesis
`/Users/ccheever/projects/snapback/llp/0329.014.002-paper-archetypes-wave-2.research.md` (WS).
RFC = `/Users/ccheever/projects/snapback/llp/0329.014.004-bounded-data-programs-v1-design.rfc.md`
(file line numbers). 0331 core as stated in the brief.

Citation keys: SD/SV = semantic design/v0; ED/EV = editor design/v0; GD/GV =
graph design/v0; RD/RV = realtime design/v0. `file:line` throughout.

Verdict conventions beyond the brief's fixed set (used so results merge):

- `CORE (split)` — satisfied by the protection-class table split (one table per
  audience). X5 appears in the *split* form only; no declared-projection feature
  is needed. Counted under X5 in the rollup as "split, no extension".
- `[X6t→schedule]` — the design compared a stored expiry to the clock; both v0
  writers rewrote it as a status column flipped by the `schedule` kind. The rule
  itself is a field compare. Counted under X6 in the rollup as "time-as-state,
  absorbed by schedule; no rule-language change".
- `X3(service, identity-only)` — a non-human actor (worker, host, webhook,
  matcher) that needs a principal. In every case below it can be an ordinary
  opaque `Principal` with a server-minted session, referenced in rules as a
  literal or as a column value; `principal.kind` never has to appear in a rule.
- Multiple *independent* one-hop probes composed with `&&`/`||`/`!` are treated
  as CORE (0331: "explicit role sets / boolean composition"). Only a probe whose
  key comes from another probe's result is X1.

---

## App 1 — Semantic notes ("Marginalia"), wave 2

Artifacts: `llp/reviews/0329.014.002-wave-2.fable-semantic.design.md` (SD, 313 lines),
`llp/reviews/0329.014.002-wave-2.codex-semantic.v0.md` (SV, 469 lines). WS:114.

**Principal shapes.** Registered users (note authors, SD:11); team admins as a
scoped role (`team_members.role owner|admin|member`, SD:106); a system
background worker that reads all content and writes only derived rows (SD:11,
SD:55); an operator for model migration (SD:268); share-link holders (SD:116,
SD:252); devices as owned rows, not principals (SD:148, SD:183). The embedding /
LLM provider is an effect target, never a principal. No anonymous viewer.

**Authorization requirements.**

| # | Requirement | Paper expression | Verdict | Note |
|---|---|---|---|---|
| 1 | Owner reads and edits own note | SD:158 `canRead(u,n) = … (n.owner_id = u ∨ …)`; SD:159 | CORE | |
| 2 | Direct user grant (viewer/editor), live = unrevoked ∧ unexpired | SD:40 inv 1; SD:114 "live iff revoked_at null ∧ (expires_at null ∨ expires_at > now)"; SV:270 `db.exists(liveUserGrants.byNoteUser,[n.id,viewer])` | CORE(where) [X6t→schedule] | `role=='editor'` is a where on the found grant row. Expiry: SV:303-304 `grant.expiresAt > Date.now() // E_AMBIENT_TIME. Rewrite: schedule flips durable state.` The v0 writer already built the live-grant projection `liveUserGrants` (SV:113-118). |
| 3 | Home-team note: `n.space = team ∧ current(u, n.team_id)` | SD:158; SD:157 `current(u,t) = ∃ team_members row (t,u) with left_at null`; SV:271 `db.exists(currentTeamMembers.byTeamUser,[n.teamId,viewer])` | CORE-with-denorm | The design keys `team_members` by `(team_id,user_id,joined_at)` as an interval history (SD:106). The v0 writer split out `currentTeamMembers` unique `(teamId,userId)` (SV:76-80 "required projection; v0 has no maintained-relation form") — which is exactly the 0331 recipe: current authority rows unique on (scope, principal), history elsewhere. |
| 4 | Team-grant arm: note shared with team `t`, viewer a *current* member of `t` | SD:40 "current member of a team the note is shared with"; SD:158 "live team-grant to some t with current(u,t)"; SV:272-275 `exists(teamGrantForNoteWhoseTeamContainsViewer)` refused `E_RULE_UNBOUNDED: the final branch is an existential join over arbitrary team grants` | **X1** (+X17 if spelled as the RFC's `any`) | The grant row's `principalId` (a team) feeds the membership probe: two hops. Denorm options: (a) cap team grants per note at K and copy the K team ids onto the note row → K independent one-hop probes (CORE-with-denorm at the price of a product cap the design never stated); (b) engine-maintained `(note, principal)` reader rows (X13) — fan-out on every membership change over every note shared with the team, unbounded. v0 integrity audit: "inv 1 **not enforceable** for team grants: rule join missing" (SV:401). Product change offered: "home-team plus direct-user sharing only" (SV:449). |
| 5 | Derived rows (blocks, versions, chunks, vectors, snippets) readable iff the note is | SD:41 inv 2; SV:261 `NOTE_CHILD(noteId): read if system or canRead(viewer,noteId)` | CORE-with-denorm (row 4's arm stays X1) | Child → note → grant is chained. Copy `ownerId`/`teamId` (immutable) onto child rows, or the RFC's `inherits(table, fk)` (RFC:277-279) as sugar. The design did not denormalize (`note_chunks` carries only `note_id`, SD:122). |
| 6 | Only the owner widens sharing; grantees and team admins only narrow; revoke by owner, the grantee, or an admin of the team named in the grant | SD:54 inv 15; SD:249 "create grant or link: owner only. Revoke: owner, the grantee themselves, or an admin of the team named in a team grant"; SV:262 `SHARE: … insert only note owner; updates may only narrow under (old,next) and immutable grant identity; delete never` | CORE(where) | Insert: one probe on the non-relationship `notes` row `where ownerId==viewer`. Revoke-by-admin: `exists(currentTeamMembers,[old.principalId, viewer]) where role in ['owner','admin']` — one hop from the grant row. Narrowing is an `(old,next)` rule. |
| 7 | Team admins manage membership, AI policy, spend | SD:11; SD:106 role enum; SV:251 `readable: x=>isTeamAdmin(viewer,x.teamId)` | CORE(where) | Closed 3-role enum, explicit sets. |
| 8 | Delete note: owner; team admins for team-space notes | SD:256 | CORE(where) | |
| 9 | Share links: possession admits; expiry, revocation, use cap; revoking the link revokes every grant minted through it | SD:16 P2; SD:53 inv 14; SD:116; SD:252 "openLink(token) … find by hash; require revoked_at null ∧ expires_at > now ∧ (max_uses null ∨ use_count < max_uses); … insert note_grants(user = caller, viewer, via_link_id)"; SV:369 "Links additionally need an argument-bound bearer capability. `ctx.newId()` is client-mintable" | **X4** [X6t→schedule] | The redeemer cannot read `share_links` (owner-only), so redemption needs full-key possession as a rule input (`unique({bearer:true})`, RFC:326-328). After redemption the grant is row 2 (CORE). The v0 writer's §8.3 found link expiry does not expire minted grants (SV:460) — a design bug, not a model gap. |
| 10 | Artifact read: requester always; anyone else needs a live `artifact_grant` **and** `canRead(viewer, n)` for every source, now | SD:52 inv 13; SD:244 "otherwise require a live artifact_grant and canRead(viewer, n) for every source *now*"; SV:298-301 `read: artifact => db.scan(artifactSources.byArtifact,[artifact.id],{take:12}).every(s=>canRead(viewer,s.noteId)) // E_RULE_UNBOUNDED: rule bodies contain no loops` | **X17 + X1** | A universal quantifier over ≤12 source rows, each of which is the multi-arm `canRead` (row 4 inside it). SV:413 "inv 13 **not expressible in a v0 rule**". The design's own U4 concession: "artifacts are private to their requester and never shareable — the simplest honest product" (SD:303); v0 product change "requester-private artifacts" (SV:446). |
| 11 | shareArtifact: the requester checks `canRead(r, n)` for every recipient (≤200 team members) × source (≤12) at share time | SD:242-243; SV:365 bound `1+h(12)+h(200)+12×200=2617` | **X11** | The sharer may not read other principals' grants (SHARE profile: a grantee reads only their own grant) or other teams' rosters, so the check runs under sealed system visibility inside the named mutation (`getHidden` / `reads:[…]`, RFC:281-283). Falls away with row 10's reduced product. |
| 12 | Background workers read all content with system authority, write only derived tables; resurfacing and saved-search jobs compute "as each user" | SD:55 inv 16; SD:195 "system worker; reads note_versions snapshots; writes only derived tables"; SD:262 "system worker computing *as each user*: viewerPartitions(u), canRead(u,·)"; SD:273; SV:260 `SYSTEM: all four require principal.kind==="system"` | **X3(service, identity-only) + X11** | One designated worker principal (an ordinary `Principal` whose session the deployment mints) plus `insert: r => viewer == INDEXER` on derived tables — no `principal.kind` in rules. "As each user" is the RFC's `db.evaluate(rule,{as})` (RFC:304-306) or, without it, the job re-implements `canRead` as program logic over rows it reads under its own visibility. |
| 13 | Model migration: operator only | SD:268 "Authorization: operator" | X11 | 0331 places operator authority outside the app plane; this is a deployment job under the system principal, not an app role. |
| 14 | Device sync acts for its owner | SD:183 "device.user_id = caller" | CORE | A device is an owned row, not a principal. |
| 15 | No hidden-note existence leak through search, related, counts, autocomplete | SD:42 inv 3; SD:66 "indexes are partitioned by visibility (personal, team) so the candidate domain *is* the viewer's domain"; SD:161 `viewerPartitions(u) = personal(u) ∪ { team(t) : current(u,t) }` | X18 (site only); predicate CORE | The per-partition admission predicate is one hop. The ranked read-site class is RFC dimension M (WS:114 "the one second read-site class"), not an authorization extension. |
| 16 | *(not authorization)* `aiAllowed(n)`, monthly spend cap by reservation, per-user rate limits | SD:160; SD:56 inv 17; SD:226, SD:232 | — | Data policy, sum-cap constraint, `rateLimit` — not who-may. Recorded so nobody re-files them as rule gaps. |

**App verdict: NEEDS: X1 (team-grant arm, also inherited by every derived row), X4 (share links), X17+X1 (artifact ∀-sources), X3(service)/X11 (worker principal, sealed checks); X18 is the site class, not an authorization item.**
Authorization was not this app's hard problem — the axis was the ranked
read site and the prediction "held exactly" (WS:114) — but the v0 writer found
two authorization rules literally inexpressible (`E_RULE_UNBOUNDED`, SV:275 and
SV:300) and ranked "bounded relational rules" third and "bearer capability"
fifth in the language delta (SV:429, SV:431). No single extension flips it to
COVERED: the RFC's `any(index, prefix, {take, where})` (RFC:276-278; WS:193-197
names "semantic's `existsJoin`" as one of its three faces) plus the two
product reductions the writers already offered (requester-private artifacts,
home-team-only sharing) would; links stay X4. The design reached for
clock-compared expiry (SD:114) — the RFC's §8 row "`ctx.now` for offers, locks,
deadlines → schedule-flipped state" (RFC:484) — and for an operator role inside
the app (SD:268), which 0331 rules out.

**Sprawl check.**
- X1 — droppable: "home-team plus direct-user sharing only" (SV:449) keeps P1, loses the "share with a team" half of P2 for non-home teams; or CORE-with-denorm under a stated cap on teams-per-note. Not load-bearing for the axis.
- X17 — droppable: requester-private artifacts (SD:303, SV:446); loses P9. Not load-bearing.
- X4 — droppable: no link sharing; loses the "expiring link" clause of P2 (SD:16) and inv 14. Stated feature, not the product's reason to exist (SD:9).
- X3(service)/X11 — load-bearing: without a worker principal nothing may write `note_vectors`/`note_chunks` under inv 16 (SD:55), and P3/P4/P7 are the product. Smallest form: one ordinary principal for the indexer; no kind taxonomy.
- X18 — not an authorization extension; belongs to dimension M.

---

## App 2 — Collaborative editor / whiteboard ("Tessera"), wave 2

Artifacts: `llp/reviews/0329.014.002-wave-2.fable-editor.design.md` (ED, 667 lines),
`llp/reviews/0329.014.002-wave-2.grok-editor.v0.md` (EV, 1130 lines). WS:118.

**Principal shapes.** Workspace members with a per-document role
`owner|editor|commenter|viewer` (ED:20-21); the workspace itself as a grant
principal (`principal_kind: 'user'|'workspace'|'link'`, ED:221-223); link guests
(viewer or commenter) with sessions that have `link_id` and no `user_id`
(ED:21, ED:230-231); replicas/devices as owned rows (ED:227); a system principal
for delivery and prune (ED:439, ED:507); push/email providers as effects.

**Authorization requirements.**

| # | Requirement | Paper expression | Verdict | Note |
|---|---|---|---|---|
| 1 | Any holder of an unrevoked, unexpired grant (user, workspace member, or link) may open the document and read all its rows; content delivered only to a current grant at the moment of delivery | ED:327-328 "any grant with `revoked_at` null and `expires_at` in the future"; ED:102-104 inv 12; EV:136 `read: d => d.status === 'active' && hasGrant(d.id)`; EV:894 "`hasGrant` without `docAccess` is 2–3 `exists` (user grant, workspace grant, membership) — over the 'one probe' of §8. Rewrite is `docAccess`." | CORE-with-denorm [X6t→schedule] | User arm: one hop. Workspace arm: the document row carries `workspace_id` (ED:218) and each user belongs to one workspace (ED:217), so it is `exists(grants,[d.id,'workspace',d.workspaceId]) && exists(members,[d.workspaceId,viewer])` — two *independent* probes keyed by the row. Child rows (ops, items, registers, threads, snapshots) then need `documentId` **and** `workspaceId` copied, or the v0 writer's flattened `docAccess (documentId, principalId) → role, status` (EV:187-205; workspace grants fan out ≤256 members, EV:37). Grants as append-only intervals (ED:223-225) must split into a current row unique on (doc, principal) plus history — EV:159 flags the interval form as "weak: many revoked rows". Expiry: EV:53 "rules still cannot read the clock (K5), so `status` is the authorization bit", flipped by `expireGrant` (EV:909-916). |
| 2 | Role gating: editor/owner submit edits, moves, restores; commenter may only thread/comment/resolve; viewer reads | ED:345-347; ED:371; ED:424; ED:489; EV:74-82 `canEdit … (a.role === 'owner' || a.role === 'editor')`, `canComment` | CORE(where) | Four roles, closed enum, explicit sets — the boundary of "explicit sets stay reviewable"; not X15. |
| 3 | Grant management: owner for owner grants; editor for lower grants | ED:465-466 "owner for owner grants; editor for lower grants they or anyone granted"; EV:161-162, EV:165-168 | CORE(where) | `(old,next)`: `old.role=='owner' ? viewerRole=='owner' : viewerRole in ['owner','editor']`; identity axes immutable. |
| 4 | Link guests: the token admits; guests see exactly what the link grants — never members-only threads or their counts | ED:21; ED:61-62 P15; ED:111-112 inv 16; ED:226 `share_links(token_hash, grant_id, expires_at)`; ED:230 `sessions(user_id?, link_id?, …)`; EV:436-437 `read: t => hasGrant(t.documentId) && (t.audience === 'everyone' || isMember(t.documentId))`; EV:85 `isMember … a.principalKind !== 'link'` | **X4** (+ a guest principal at the identity kind) | Bearer token → redemption mints an ordinary guest `Principal` (0331: "Guest claim should preserve the same principal") and a grant row carrying `viaLink`; thereafter `isMember` is `where viaLink == null` on the found grant row — CORE(where). No `principal.kind` in rules. Counts: two maintains with declared `readable` (EV:519-530) — X14, not authorization. |
| 5 | Presence visible only to co-grantees, re-validated on every grant change | ED:109-110 inv 15; ED:453-454; EV:883-892 `channel … publish: a => access(a.documentId)?.status === 'active'`; EV:1049 delta 5 | CORE (channel kind) | Same one probe. Cutting subscribers when the probe row changes is the RFC channel kind's own semantics (RFC:274 "invalidated when the probe's durable row changes"), not a rule extension. |
| 6 | Revocation cuts live delivery within 10 s; offline batches are re-authorized at arrival and kept on the device | ED:105-108 inv 13-14; ED:348-349 Op 2 step 1; ED:466-470 Op 9; EV:899-907; EV:919 "Live **queries** whose rule probes `docAccess` rerun on that write"; EV:1017-1019 "v0 fits" | CORE | 0331's live trace plus outbox re-authorization. The design's `sessions` are ordinary app rows bound to a grant, not identity-kind sessions. |
| 7 | Undo scoped to the authoring replica; an op insert bound to *this* device | ED:85-87 inv 5; EV:746 "there is no `ctx.replica`"; EV:1047 delta 4 `ctx.replica … insert op.replicaId === ctx.replica` | **X9** (droppable) | Core gets `exists(replicas,[o.replicaId]) where userId == viewer` (the replica is the viewer's), not *which* of the viewer's devices is acting. The residual is same-principal integrity: a user forging their own other device's id. |
| 8 | Mentions: notification content only if the recipient holds a grant at delivery time; otherwise withheld and an access request; system delivers | ED:113-114 inv 17; ED:428-431; ED:439 "Auth: system"; EV:474-479; EV:491-496 `notifications … insert: n => principal.kind === 'system'`; EV:849-862 delivery re-check | CORE (in-app) / X3(service)+X11 (push effect) | In-app: `notifications.read: n => n.userId == viewer && exists(docAccess,[n.documentId, viewer])` re-checks at read; the comment body is rule-mediated at read. Only the external push/email effect must read under a service principal at send time (RFC:275 effect kind). |
| 9 | Access requests: requester creates one for a document they cannot read; editors decide | ED:287-288; EV:508-513 `insert: r => r.requesterId === viewer`, `update: canEdit(old.documentId)` | CORE | The insert rule does not probe the document, so no existence oracle. |
| 10 | Workspace: members read; owner adds/removes/promotes; creator seats | EV:94-99; EV:112-120 `db.get(members.byWorkspaceUser,[m.workspaceId, viewer])?.role === 'owner'`; EV:137-138 document insert requires membership | CORE(where) | Two-role enum; `createWorkspace`/`createDocument` insert the creator's owner row under 0331's transaction-local creation provenance. |
| 11 | Comments readable iff their thread is | EV:457 `read: c => db.get(threads, c.threadId) !== null` | CORE-with-denorm | Comment → thread → docAccess is chained. Copy `documentId` and `audience` (immutable) onto comments; the v0 writer copied `documentId` (EV:447) but not `audience`; the design's `comments` has only `thread_id` (ED:280). |
| 12 | System compaction deletes items and writes snapshots | ED:507 "Auth: system"; EV:314-319 `delete: principal.kind === 'system' ? true as never : never, // prune only` | X3(service)/X11 | A `job` under the system principal (RFC:273). |
| 13 | *(not authorization)* audience-scoped counts; 30-day replica frontier for prune | ED:111-112 inv 16; ED:119-121 inv 20 | X14 | Disclosure and retention. |

**App verdict: NEEDS: X4 (link guests), X3(service)/X11 (delivery effect, prune job); X9 droppable. Everything else CORE or CORE-with-denorm.**
Authorization was not the hard problem — "The defect that matters is not
missing `scan`: it is **compose**" (EV:47) — but Trap 5 (ED:178-190, "a live
subscription, a presence row, an offline queue, and a mention all outlive a
grant unless something re-checks") is squarely an authorization trap and 0331's
live trace plus outbox re-authorization is the exact answer (EV:1017-1019 rate
inv 12-14 as "v0 fits"). The single extension that flips it to COVERED is X4:
if link guests must sign in first, the bearer link is all that is missing. The
design reached for clock-compared grant expiry (ED:328) — RFC:484 — and for
presence re-validated on a 10 s timer (ED:453-454), which the RFC's channel
kind supersedes with probe-row invalidation. The wave's rule-1 finding
(WS:165-170, hidden rows consuming `take` starve a guest's page) is a
disclosure/completeness interaction with the guest audience, resolved by
uniform-read logs, not by a rule change.

**Sprawl check.**
- X4 — load-bearing: link guests are a first-class user class (ED:21) with their own promise P15 (ED:61-62); without bearer links, "share by link" is gone and the guest audience split is moot. Smallest form: `unique({bearer:true})` on `share_links.token_hash`; the guest as an ordinary principal.
- X3(service)/X11 — load-bearing for the push effect and the prune job, in the "one system principal" form only; the in-app notification path is CORE.
- X9 — droppable: trust the device's `replicaId` under a CORE(where) ownership check; nothing cross-principal is lost.

---

## App 3 — Professional network / issue DAG ("Joinery"), wave 2

Artifacts: `llp/reviews/0329.014.002-wave-2.grok-graph.design.md` (GD, 791 lines),
`llp/reviews/0329.014.002-wave-2.fable-graph.v0.md` (GV, 386 lines). WS:115.

**Principal shapes.** Members (GD:7); project leads as a scoped role
`owner|lead|member|guest` on `projectMembers` (GD:8, GD:289); company admins via
`companies.claimedByMemberId` (GD:9, GD:258); a system principal for invite
expiry, hop-3 rebuilds, DAG repair (GD:10, GD:646); an anonymous viewer treated
as distance ∞ except `discovery='world'` cards (GD:481); the GitHub webhook
applied under system after signature verification (GD:623-625).

**Authorization requirements.**

| # | Requirement | Paper expression | Verdict | Note |
|---|---|---|---|---|
| 1 | Full profile iff hop-distance ≤ 2: an accepted edge, or a common accepted neighbor; blocks subtract | GD:30 promise 3; GD:55 inv 1 "Distance is a fact about accepted edges right now"; GD:371-375 `commonNeighbor(V,S) := scan connectionAccepted.bySrc where srcId=small take 5000; for each n: … exists (n.dstId, large)`; GV:57-58 `hop2 = !blocked(v,s) && (v === s \|\| hop1(v,s) \|\| any(connectionAccepted.bySrc, [v], { take: 5000, where: n => hop1(n.dstId, s) })) // L1` | **X1 + X17** (one primitive: the RFC's `any`) | The found edge's `dstId` feeds the second probe; bounded by the degree cap 5000 (GD:73 inv 19). Alternative: a join-maintained 2-path witness relation keyed `(a,b)` (GV:352 L3: "write amplification per accept `2·(deg A + deg B) ≤ 20,000` … storage ≈ 20× the edge table") — that is X13, not core. Load-bearing: GD:722 "Cheat: drop 2-hop full-profile and network-issue ACL … Then reachability is no longer load-bearing; the app is a project tracker with a friends list." |
| 2 | Card iff hop ≤ 3 (generation-fenced hint), or `discovery='world'`, or a shared current project | GD:29 promise 2; GD:232-241 `neighborhood3 … Authorization for a 3rd-degree card must re-check … if observerGeneration ≠ members[observer].neighborhoodGeneration`; GD:382-387 `card3Hint`; GV:59-61 `cardReach = hop2 \|\| (!blocked && (db.get(neighborhood3.byPair,[v,s])?.observerGeneration === db.get(neighborhoodGeneration,[v])?.value \|\| any(projectMembers.byMember,[v],{take:100, where: p => db.exists(projectMembers.byProjectMember,[p.projectId, s])})))` | **X1** (hint fence; shared-project arm) + X11 (hint-writing job) | The hint's `where` needs the viewer's own current generation — a value from a second probe, not a rule term. The shared-project arm is viewer's projects → subject's membership (pair-shaped; no bounded denorm). The design's own concession removes 3rd-degree cards from authorization (GD:720 "Concession that is not a cheat: drop 3rd-degree cards"; GV:368 "Drop `onlineThreeHop`"). GV:382 §8.3: "3rd degree is a discovery tier wearing an authorization promise." |
| 3 | Block is absolute for profiles and silent; a missing handle and an out-of-reach one return the same body | GD:35 promise 8; GD:58 inv 4; GD:60 inv 6; GD:370 `blocked(V,S) := exists blocks (V,S) OR exists blocks (S,V)`; GV:55; GV:91 `blocks … read: b => b.blockerId === viewer`; GV:322 "hidden `blocks` rows → verdicts" | CORE(neg) | Two negated one-hop probes over rows the blocked party may not read — evaluated as verdicts (0331: rule-input visibility derives from table policy; the spike's `input_visibility` note). Oracle subtlety: a rule-mediated point read must not ship an absence receipt that distinguishes missing from hidden — GV:354 L4; WS:208-210; RFC:475 "absence indistinguishable from hidden". |
| 4 | Email to self and 1st-degree with `shareEmailWithConnections`; card / full / private column tiers | GD:174; GD:19-21; GV:69-79 `memberCards` / `memberProfiles` / `memberPrivate`; GV:78 `read: m => m.id === viewer \|\| (m.shareEmailWithConnections && hop1(viewer, m.id))` | CORE (split) | Protection-class split; no column ACL or declared projection needed (RFC:338-342). |
| 5 | Issue readable iff current project member, or `visibility='network'` ∧ hop2(viewer, assignee), or creator (stub); body for project members only | GD:589-593; GD:70 inv 16 "We do not keep a stored ACL list of neighborhood readers"; GV:64-65 `canReadIssue`; GV:171 `issueBodies … read: b => member(db.get(issues, b.issueId).projectId)` | Arms 1,3 CORE; arm 2 **X1+X17**; bodies CORE-with-denorm | Arm 2 is revocable by a third party who is neither viewer nor assignee (GD:748-756 U5) — live via the trace once `any` exists. Bodies: copy `projectId` (immutable) onto `issueBodies` instead of chaining through the issue row. |
| 6 | Issue writes: member (not guest) updates; only lead/owner changes visibility or assigns others; a member assigns self/none; assignee must be a current member; close by assignee, lead/owner, or a member who is assignee/creator | GD:71 inv 17; GD:570; GD:665; GV:164-167 `update: (o,n) => member(o.projectId) && !guest(o.projectId) && … && (n.visibility === o.visibility \|\| lead(o.projectId)) && (n.assigneeId === o.assigneeId \|\| lead(o.projectId) \|\| n.assigneeId in [viewer, 0])` | CORE(where) | `(old,next)` plus one-hop probes keyed by row fields (`[o.projectId, n.assigneeId]` — a principal-valued field as a key is admitted). Four-role closed enum. |
| 7 | Startability: `in_progress` only when the transitive open-blocker count is 0; binds every writer; hidden blockers still block | GD:66 inv 12; GD:68 inv 14; GV:165 `(n.status !== 'in_progress' \|\| db.get(transitiveOpenBlockerCount, [o.id])?.value === 0) // I12 binds every write`; GV:329 | CORE(where) over a maintained row; the row's existence needs **X2** (`dag` closure) + `maintain.count` | An integrity guard, not a who-may question; the count is maintained over an engine-written closure because "the writer cannot see the rows it must write" (GV:350 L2; WS:218-219). X6-computed in the brief's vocabulary. |
| 8 | Add dependency: member (not guest) of A's project; must be able to read B; guests cannot | GD:542 "V must **read** B under Op 10's rules (cannot depend on work you cannot see)"; GV:176-179 `insert: d => … member(db.get(issues, d.issueId).projectId) && !guest(...) && canReadIssue(db.get(issues, d.blockerIssueId))` | CORE-with-denorm (`projectId` onto deps) + program-level `require` | The named mutation's rule-mediated `get(B)` composes policy; requiring non-null is CORE at program level. Binding "can read B" on *raw* inserts would need a chained probe (X1) — an X19-shaped cross-row admissibility. Droppable to program discipline. |
| 9 | Connection lifecycle: request (not blocked, no current edge, no pending pair, caps 100 out / 500 in), accept (pending invite addressed to viewer, not blocked, degree ≤ 4999), end/block by either party | GD:399; GD:421; GD:444-445; GD:465; GV:83-86 `insert: e => (e.srcId === viewer \|\| e.dstId === viewer) && !blocked(e.srcId, e.dstId) && db.exists(pendingInvites.byPair, [other, viewer])`, `delete: e.srcId === viewer \|\| e.dstId === viewer`; GV:101-105 caps | CORE(neg) + constraints | Caps are `cap({by})` constraints with sealed refusal (GV:310 "no read at all; refusal sealed"). The acceptor inserts the reciprocal row whose `srcId` is the other member — a principal-valued row field, admitted. |
| 10 | Recommendations: insert only at distance 1; readable if the viewer is hop2 to the recipient | GD:276; GV:129-130 `read: r => hop2(viewer, r.toMemberId), insert: r => r.fromMemberId === viewer && hop1(viewer, r.toMemberId)` | insert CORE; read X1+X17 (row 1) | |
| 11 | Company pages public; first claimant becomes admin; roster rows public while current and opted in | GD:258; GV:136 `update: (o,n) => (o.claimedByMemberId === 0 && n.claimedByMemberId === viewer) \|\| o.claimedByMemberId === viewer`; GV:142 `(c.rosterPublic && c.span.to === null)` | CORE / CORE(where) [X6t] | `public(reason)`; `(old,next)` claim. |
| 12 | Anonymous viewer: distance ∞ except `discovery='world'` cards | GD:481 "or anonymous, which is treated as distance ∞ except `discovery = world` cards" | **X3(anon)**, droppable | Mentioned once. Reduced product: sign in to see world cards. |
| 13 | System jobs: invite expiry as a write; hint/PYMK rebuild; GitHub delivery under system after signature | GD:74 inv 20 "Invite expiry is a write … A read never treats `now > expiresAt` as authorization by itself"; GD:609; GD:646; GD:623-625; GV:100 `schedule(expireInvite, …principal: 'system')`; GV:118-126 `insert: () => system`; GV:295 "under **which principal the spec does not say** (L6; assumed `system`)" | schedule CORE; X3(service)/X11 for job-written tables and the webhook effect | The design already chose the schedule-flipped form for expiry (the RFC's answer). Hint/PYMK jobs vanish with row 2's concession; PYMK "is not a privilege" (GD:720). |
| 14 | *(not authorization)* structural counts disclosed under a declared `readable`; search reach set | GD:62-63 inv 8-9; GD:68 inv 14; GV:87-88 `maintain.count … readable: r => hop2(viewer, r.srcId)`; GV:186-187; WS:198-202 | X14 | The ruling-8 hole (hoisted-false rule → `count() = 0`, GV:346 L0; RFC:476) is disclosure, not authorization. |

**App verdict: NEEDS: X1+X17 (the two-hop `any`; load-bearing), X2 (`dag` for the startability guard; integrity), X3(service)/X11 (job writers, webhook), X3(anon) droppable.**
Authorization *was* the hard problem: U1 "Variable-length path as an
authorization predicate" (GD:714-722) and "how do you authorize on
reachability" (GD:791). The single extension that flips it to COVERED (with
3rd-degree cards dropped per the design's own concession, anonymous sign-in
required, and the DAG guard counted as integrity) is `any(index, prefix,
{ take ≤ cap, where })` in rules — X1 and X17 as one primitive, which the RFC
adopted (RFC:276-278; §8 row "§2: `tree` makes recursive ACL one indexed read →
`nearest` + `any` in rules", RFC:472). The design itself reached for a stored
3-hop hint as authorization behind a generation fence (GD:232-241) while
warning against stored distance (GD:82-95 T1); the v0 writer's §8.3 (GV:382)
and WS:115 ("*not* held that reachability visibility needs a transitive
closure — two hops need a rule-side `any`") settle it: two hops are a rule,
three hops are a job, and a job's output is discovery, not authority. Also
RFC:475 (ruling 3, graph) and RFC:476 (ruling 8, graph).

**Sprawl check.**
- X1+X17 (`any`) — load-bearing: GD:722 says removing 2-hop authorization turns the app into "a project tracker with a friends list". Without it, the only honest product is 1-hop profiles + project-only issues — the design's stated cheat boundary (GD:758).
- X2 (`dag`) — load-bearing for I11-I13 (GD:65-67) but as integrity: GD:730 "Cheat: store direct blockers only … Then I11–I13 are gone." Not an authorization extension; the rule that consumes it is CORE(where).
- X3(service)/X11 — droppable to "schedules run as one system principal": hint/PYMK jobs go with 3rd-degree cards; the GitHub import is a stated feature (GD:8, Op 12) needing one webhook principal.
- X3(anon) — droppable: require sign-in for world cards; loses nothing the 16 promises depend on.
- X13 (join-maintained hop2 relation) — not required; it is the alternative lowering of X1 (GV:352 "unpickable without measurement").

---

## App 4 — Realtime multiplayer arena ("Ricochet"), wave 2

Artifacts: `llp/reviews/0329.014.002-wave-2.fable-realtime.design.md` (RD, 190 lines),
`llp/reviews/0329.014.002-wave-2.grok-realtime.v0.md` (RV, 1231 lines). WS:120.

**Principal shapes.** Players (RD:9); spectators — anyone for casual, join-code
holders for custom, friends of a participant for ranked (RD:141); staff as a
global role (RD:9, RD:44; RV:102-107 `staff{playerId}`); the host simulation
process with an epoch fence and "no player-callable path" (RD:147); system
(matchmaker lease RD:126, liveness monitor RD:150); the payment provider webhook
"applied with system authority" (RD:159); the orchestrator as an external
effect target; devices (desktop vs phone companion) as connection facts on the
host, not data-plane principals (RD:29 P16); bearer secrets — `joinCode` "the
secret" (RD:84), `sessionToken` (RD:90), signed `spectatorToken` (RD:141).

**Authorization requirements.**

| # | Requirement | Paper expression | Verdict | Note |
|---|---|---|---|---|
| 1 | Self-only durable rows: profile, inventory, loadout, balances, statements, own results, own visible sanctions | RD:26 P13; RD:103 "the player-visible view excludes `lowPriority` rows"; RV:83 `self = pid === viewer \|\| sys() \|\| isStaff()`; RV:116-119, 490-501, 521-533, 559-573 | CORE | |
| 2 | Staff read exact ratings and cheat reviews; adjust, ban, confirm | RD:9; RD:44 inv 11 "Exact rating is readable only by its owner and staff"; RD:162; RV:82 `isStaff = () => db.exists(staff.byPlayer, [viewer])`; RV:598-611 | CORE | A global role is a scope-less relationship row probed by `[viewer]` alone. 0331 defers the *concept* of global roles; the mechanism needs nothing beyond one hop. |
| 3 | Participants read match/lobby/round rows; `readyState` visible to all eight, `ratingAtStart` self/staff, `sessionToken` self-only, `pool` system-only | RD:90; RD:44-45 inv 11-12; RV:84-85 `inMatch = db.exists(participantsPublic.byMatchPlayer, [matchId, viewer]) \|\| sys() \|\| isStaff()`; RV:330-376 `participantsPublic` / `participantsPrivate` / `participantSecrets`; RV:1204 §8.1 "one row with three audiences" | CORE (split) | RFC:338-342 credits realtime with refuting column-level rules; WS:211-214. |
| 4 | Spectator permits: anyone (casual), join-code holders (custom), friends of a participant (ranked); nothing a participant can read carries spectator information | RD:20 P8; RD:43 inv 10; RD:81 "Used for ranked spectating permission"; RD:141; RV:635-646 `read: p => p.viewerId === viewer \|\| sys(), // I10: participants do not read this`; RV:1038 "Ranked: `exists friendships.byPair [viewer, participant]`" | casual CORE(where); ranked CORE-with-denorm; custom **X4** | Casual: `insert: p => p.viewerId == viewer && exists(matches,[p.matchId]) where mode=='casual'`. Ranked: store the witness `friendOf` on the permit row → `exists(friendships,[viewer, p.friendOf]) && exists(participantsPublic,[p.matchId, p.friendOf])` — two independent probes. Custom: the join code is a bearer secret; a `public` read on `joinCodes` would let a scan enumerate codes (RV:1074), so it needs `unique({bearer:true})`. "No spectator count" (RV:1096) is X14. |
| 5 | Checkpoint, settlement, heartbeat, markLive: only the host holding the current epoch, in the expected state; no player-callable path; never predicted | RD:37 inv 4; RD:16 P4; RD:144; RD:147 "Auth: the host with the current epoch; no player-callable path"; RD:176 U1 "(a) conditional multi-row transactions callable by an external system with a fencing guard"; RV:322-328 `matchHostAuth` sys-only; RV:907 "**epoch is not a capability** … with `sys()`-only writes the **host cannot call them** unless workers share the system principal (stolen key = god)"; RV:1140 delta 1; RV:1208 §8.3 "a language whose only principals are `viewer` and `system`" | **X3(host, identity-only)**; the rule is CORE(where) once the host is a principal | Mint one ordinary `Principal` per `(match, epoch)` when the allocation effect starts a host, store it as `matches.hostPrincipal`, and write `rounds.insert: r => exists(matches,[r.matchId]) where hostPrincipal == viewer && state == 'live'`. A fenced-out host holds a principal that no longer matches; `hostKey`, `callable:'host'`, and a system-shared key disappear; `predict:false` follows because no player device can satisfy `viewer == hostPrincipal`. The payload-hash idempotency (RD:147) is a constraint, not authorization. |
| 6 | Party leader queues all current members; members read the party; leader-only lobby ops | RD:123 "the caller, or the party leader for all current members"; RV:219-225; RV:252-261 `insert: q => q.playerId === viewer \|\| (db.get(parties, q.partyId)?.leaderId === viewer && db.exists(partyMembers.byPartyPlayerLive, [q.partyId, q.playerId, 0])) \|\| sys()` | CORE(where) | `leaderId` is a field of the party row; two independent one-hop probes keyed by row fields. |
| 7 | Low-priority pool is never disclosed; queue entry must be classified from system-only sanctions | RD:45 inv 12; RD:26 P14; RV:264-277 `matcherPools … read: _ => sys()`, "`insert: true` above is a hole"; RV:575-584; RV:795 "Pool classification as the leader is **not a plan** that both (a) reads `matcherSanctions` and (b) does not disclose it"; RV:1144 delta 3 `phase: 'system'` | **X11** (system continuation / sealed read) | Reduced form with no new construct: classify at formation inside `formMatches` (already a system schedule, RV:825 "pool from `matcherPools` under sys"); what remains is only "schedules run as one system principal" (X3 service). |
| 8 | Bans and cooldowns block queueing; catalog/season windows gate purchases | RD:123 "Sanctions active at now per member: `ban` → `BANNED(until)`"; RD:26 P14; RV:71 "`interval` stored for display; **authorization is `status`**, flipped by schedule"; RV:765-770 | CORE(neg) [X6t→schedule] | As a rule: `queueEntries.insert: q => !exists(sanctionsVisible.byPlayerStatus,[q.playerId,'active','ban'])`. RV:735 shows the intent-clock version is "legal in a mutation and WRONG under intent reuse". |
| 9 | Money: entries written only by settlement/system/purchase; a player may only debit themselves; provider webhook under system | RD:16 P4; RD:22 P10; RD:159 "the webhook by provider signature, applied with system authority"; RV:456-474 `insert: e => sys() \|\| e.playerId === viewer`; RV:691 "a second mutation `printCoins` that inserts `currencyEntries` with `playerId === viewer` (insert rule)" | CORE(where) given X3(service); webhook X3(service)/X11 | `insert: e => viewer == SYSTEM \|\| viewer == hostPrincipal-of(e.refId) \|\| (e.playerId == viewer && e.delta < 0)` closes the `printCoins` hole. The overdraft floor is a sum constraint (RV:1158), not who-may. |
| 10 | Occupancy: a player flips own `idle↔queued`; everything else system | RV:123-144 `immutableExcept … (o.kind === 'idle' && n.kind === 'queued') \|\| (o.kind === 'queued' && n.kind === 'idle')` | CORE | `(old,next)` transitions. "Queued iff a live queue row exists" is cross-table exclusive-open (RV:1156) — X19 integrity, not authorization. |
| 11 | Per-participant session token; the host verifies it; newest connection takes over | RD:90; RD:135; RV:366-376 `read: p => p.playerId === viewer \|\| sys(), // host reads via system invoke` | CORE(where) under row 5's host principal | The in-match connection is off the data plane (host); the token row's read rule is one hop on `matches.hostPrincipal`. |
| 12 | *(not authorization)* leaderboard snapshot with a public histogram; no spectator count; `predict:false` on purchases | RD:23 P11; RV:613-623, 679-686; RV:1055; RV:1146 delta 4 | X14 / client declaration | Disclosure and prediction posture. |

**App verdict: NEEDS: X3(host/service; identity-only), X11 (sealed pool classification — droppable to schedule-as-system), X4 (custom-lobby join codes). Everything else CORE, CORE(where), CORE(neg), or a split.**
Authorization was not the axis (the 30 Hz simulation stays outside the data
plane, WS:120), yet the v0 writer's first-ranked language delta is an
authorization item — "Host/worker principal + capability-bearing invoke …
Without it Op 9 is god-mode or unreachable" (RV:1140) — and §8.3 (RV:1208)
is the collision between a player-readable `matches` row, a host that is not
a principal, and prediction of every client mutation. The single extension
that flips it to COVERED is a server-minted principal for a non-human process
(host, webhook, matcher) — X3 in its narrowest form, with no `principal.kind`
in rules — after which the epoch fence, `callable:'host'`, and `predict:false`
on settlement all reduce to an ordinary `where` on the match row. The design
reached for "Sanctions active at now" (RD:123) — RFC:484 — for one
`participants` row with three audiences (RD:90) — RFC:489 "a readable row is
fully readable → projections" and RFC:338-342 — and for a host authority the
v0 spec had no principal for — RFC:479 "§7: read elevation is never needed to
settle … → `callable: 'system'`/`'host'`; declared system reads".

**Sprawl check.**
- X3(host/service) — load-bearing: settlement (RD:147), checkpoints (RD:144), and the payment webhook (RD:159) have no honest reduced product — someone non-human must write `matchResults`, `currencyEntries`, and `rounds`. Smallest form: an ordinary opaque principal minted per host epoch and one for the provider webhook; no kind taxonomy, no `callable` declaration.
- X11 — droppable: move pool classification into the system-run matcher; P14 (RD:26) survives. The settlement-as-sealed-write case is absorbed by X3 above.
- X4 — droppable: custom lobbies by code (RD:9 "custom (join code)") could become invite-by-friend; loses a stated mode. Not the product's core.
- X1 — avoided entirely: the ranked-spectator friend witness is a denormalized column on the permit row.

---

## Slice rollup

| X | Apps (of 4) | Where | Load-bearing vs droppable |
|---|---|---|---|
| X1 multi-hop | 4 | semantic team-grant arm (SV:272-275); editor workspace arm (EV:894) — reduces to CORE-with-denorm; graph hop2 (GV:57-58) and 3-hop fence; realtime ranked spectator — reduces to CORE-with-denorm (witness column) | **Load-bearing in graph only** (GD:722). Semantic: droppable by product cap or home-team-only sharing. Editor and realtime: denorm-able. |
| X17 quantified | 2 | semantic ∀ ≤12 artifact sources (SV:298-301); graph `any … take 5000` (GV:58) | Graph load-bearing as the same `any` primitive as X1; semantic droppable (requester-private artifacts, SD:303). |
| X4 bearer | 3 | semantic share links (SD:252); editor link guests (ED:226, ED:230); realtime join codes (RD:84) | Editor load-bearing (guest user class, P15). Semantic P2 and realtime custom mode are stated features, droppable with a named loss. |
| X3 principal kinds | 4 (service/host) + 1 (anon, graph) + 1 (guest, editor) | worker (SD:55), delivery/prune (ED:439, ED:507), hint job + webhook (GD:646, GD:623), host + webhook + matcher (RD:147, RD:159, RD:126) | **Load-bearing in the narrow form only**: an ordinary opaque `Principal` with a server-minted session for a non-human actor, named in rules as a literal or column value. `principal.kind`, `bearerOf`, bindings, and sets never appeared in a rule. anon: droppable (GD:481). guest: an identity-kind matter, no rule change. |
| X11 sealed/system authority | 4 | semantic O8/O11/O13/O12 (SD:243, 262, 273, 268); editor push effect + prune; graph hint/PYMK job + webhook; realtime pool classification (RV:795) + settlement (RV:1140) | Collapses to "schedules/jobs/effects run as one system principal" in every app; realtime settlement collapses into X3(host). The `phase:'system'` continuation is droppable in realtime by classifying at formation. |
| X2 hierarchy | 1 | graph `dag` closure feeding the startability guard (GV:165, 180-181) | Load-bearing for integrity (GD:730), not for who-may; the consuming rule is CORE(where). No `nearest`/`inherits` needed for *authority* in this slice (`inherits` is optional sugar for semantic row 5). |
| X5 audience projection | 2 (split form) | graph member tiers (GV:69-79); realtime participants (RV:330-376) | Satisfied by the table split; no declared-projection feature. |
| X6 time-as-state | 4 (absorbed) | grant/link expiry (SD:114, ED:328), invite expiry as a write (GD:74), sanctions/catalog (RD:123, RV:71) | Never a rule-language change: a status column plus the `schedule` kind. X6-computed: graph's maintained count (row 7). |
| X9 device context | 1 | editor `ctx.replica` (EV:1047) | Droppable; same-principal integrity only. |
| X13 maintained authority | 0 required | alternative lowering of X1 in semantic and graph (GV:352) | Not needed. |
| X14 disclosure/retention | 4 | counts with declared `readable` everywhere | Not authorization; noted only. |
| X18 ranked-site rule | 1 | semantic partitions (SD:66) | The site class, not an authorization extension; predicate is CORE. |
| X19 cross-row write | 2 (weak) | graph "must read B" on raw inserts (GD:542); realtime occupancy exclusive-open (RV:1156) | Program-level `require` / integrity constraint; not needed as a rule extension. |
| X20 named-principal evaluation | 2 | "as each user" jobs (SD:262, SD:273), delivery re-check (ED:439) | Folded into X11; the RFC's `db.evaluate(rule,{as})` (RFC:304-306) is the declared form, program-side duplication the fallback. |
| X7, X8, X10, X12-as-extension, X15, X16 | 0 | every one-hop `where` was CORE(where); every negation was CORE(neg) with the absence-receipt caveat (GV:354); max 4 roles per scope | Not present. |

**One-paragraph reading.** Across the four apps, 0331's core (one-hop probes,
boolean composition, `(old,next)`, closed enums, transaction-local creator
provenance, live trace revocation, no-oracle reads) covered every *human*
who-may rule except two-hop reachability, which one app (graph) is built on
and one app (semantic) uses for cross-team sharing; both are the RFC's `any`
(X1+X17 as a single primitive), and the other two apps reach the same shape
but denormalize it away. The remaining recurring gap is not a rule-language
gap at all: every app has a non-human writer (indexing worker, delivery/prune
job, hint job and webhook, host process and payment webhook) that needs a
principal, and every one of those is satisfied by an ordinary opaque
`Principal` with a server-minted session — no kinds, no `callable`, no epoch
secret once the host is a principal. Bearer capabilities (X4) appeared in
three of four apps and are load-bearing only where a guest user class exists
(editor). Nothing in this slice needed role hierarchy, permissions-as-data,
device-plane evaluation, rule composition, or session/posture context.
