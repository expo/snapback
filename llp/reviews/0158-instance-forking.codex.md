# LLP 0158 instance forking review — Codex family

## Round 1 — 2026-08-03

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli`, `codex exec`, model `gpt-5.6-sol`,
`model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author `codex exec` context over the working tree at
29699bd6; instructed to read LLP 0158 in full plus LLP 0097, LLP 0088, and
LLP 0018, to spot-check the §Implementation path seam inventory against
`src/branches.rs`, `src/config.rs`, `src/cli.rs`, `src/server.rs`,
`src/local.rs`, and `src/instance_lock.rs`, and not to read anything
under `llp/reviews/` concerning 0158. Orchestrated by the Fable session
that authored the draft, which therefore does not count as a reviewer;
this artifact records the Codex review verbatim below. Author verification
before application: the novel load-bearing citations were checked against
the tree and are accurate — the resume keyring is a `secure_file` sidecar
beside the database separate from the auth keyring (src/local.rs:18498
region, LLP 0091 ref), asset physical keys are UUIDv7 and explicitly
"never derived from app data, filenames, or digests" (src/assets.rs:1900),
auth transactions run through a protected lane distinct from the app
journal (src/local.rs:4004 region), and `MaterializedBase` snapshots the
source into a fresh database via the backup primitive with an atomically
consistent recorded base version (src/branches.rs:356).

---

## 1. Overall assessment

LLP 0158 identifies a real residual need: schema/function-divergent, independently hosted copies are not served by LLP 0097, and the proposal correctly avoids reopening record-level merge. However, F0 rests on false safety assumptions: effect capture is not wired into runtime egress, rotating the auth incarnation does not invalidate every copied credential, and the current asset layout cannot safely provide shared blobs. The rogue-agent promise also exceeds the protection supplied by a same-user process and database clone.

## 2. Verdict

**NOT READY.** Graduation or F0 implementation would encode unsafe defaults until the identity, egress, asset, and adversarial-containment contracts are redesigned and proven with bypass tests.

## 3. Strengths

- The schema/function-divergence residual is real: LLP 0097 explicitly shares the parent’s schema and function bundle, so it cannot serve the primary schema-divergent workflow as designed. [LLP 0158 §Relationship to LLP 0097](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:135), [LLP 0097 §Design 1](/Users/ccheever/projects/snapback/llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:47)

- The proposal correctly keeps semantic merge out of the sync core and does not reopen LLP 0088’s record-level branching design. [LLP 0158 §Why this is still not LLP 0088 reopened](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:195), [LLP 0088 §4](/Users/ccheever/projects/snapback/llp/0088-record-history-and-branching.rfc.md:173)

- Continuing numeric versions from the fork point is reasonable, provided the fork receives a new data-stream identity and all consumers treat `(instance/stream identity, version)` as the coordinate. [LLP 0158 §The fork operation](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:248)

- The narrow config-store claim checks out: LLP 0036 secret values reside in a per-database `*.config.json` sibling rather than SQLite. [src/config.rs:1](/Users/ccheever/projects/snapback/src/config.rs:1), [src/config.rs:272](/Users/ccheever/projects/snapback/src/config.rs:272)

- `SNAPBACK_CRON_DISABLED` and `SNAPBACK_JOBS_DISABLED` exist, and a new process does start with empty in-memory ephemeral/subscriber state. Their semantics are narrower than the RFC states, but the underlying seams are real. [src/cli.rs:622](/Users/ccheever/projects/snapback/src/cli.rs:622), [src/server.rs:3241](/Users/ccheever/projects/snapback/src/server.rs:3241), [src/local.rs:18528](/Users/ccheever/projects/snapback/src/local.rs:18528)

- The spike is commendably explicit that it proved file cloning and boot only, not runtime quarantine. [LLP 0158 §Spike evidence](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:380)

## 4. Concerns

1. **Blocker — §Implementation path falsely describes effect capture as built machinery requiring one boot switch.** `BranchExecutionMode` and `EgressDisposition` are declarations inside `branches.rs`; a source-wide search finds no runtime consumer outside that module. `capture_effect` additionally requires a `BranchId` and an existing child-version stream, neither of which a fork has. [src/branches.rs:552](/Users/ccheever/projects/snapback/src/branches.rs:552), [src/branches.rs:685](/Users/ccheever/projects/snapback/src/branches.rs:685) The actual action host has no isolation-mode field, while `fetchStream`, buffered `ctx.fetch`, push delivery, and push-receipt maintenance initiate network requests directly. [src/server.rs:929](/Users/ccheever/projects/snapback/src/server.rs:929), [src/server.rs:1727](/Users/ccheever/projects/snapback/src/server.rs:1727), [src/server.rs:1962](/Users/ccheever/projects/snapback/src/server.rs:1962), [src/server.rs:2113](/Users/ccheever/projects/snapback/src/server.rs:2113), [src/server.rs:16455](/Users/ccheever/projects/snapback/src/server.rs:16455) This directly contradicts LLP 0097, which calls exhaustive host-egress mediation a prerequisite rather than an existing fact. **Resolution:** reopen OQ2; thread an isolation policy to every actual outbound-initiation point, refuse any unmediated operation, decide how captured calls obtain simulated results, and add negative tests for buffered fetch, `fetchStream`, push send/receipts, provider adapters, notifications, payments, webhooks, and native modules.

2. **Blocker — the identity mint does not invalidate copied credentials as claimed.** The cited function is not in `src/local.rs`; `ensure_authorization_stream_incarnation` is in `src/storage/auth_stream.rs` and explicitly preserves an existing incarnation. [src/storage/auth_stream.rs:21](/Users/ccheever/projects/snapback/src/storage/auth_stream.rs:21) More importantly, rotating that metadata leaves `_auth_sessions` and their token hashes intact; startup projects those copied rows into the new stream, and bearer resolution is then by copied digest. [src/storage/auth_stream.rs:187](/Users/ccheever/projects/snapback/src/storage/auth_stream.rs:187), [src/auth/session_projection.rs:1363](/Users/ccheever/projects/snapback/src/auth/session_projection.rs:1363), [src/auth/session_projection.rs:1691](/Users/ccheever/projects/snapback/src/auth/session_projection.rs:1691) There is even a test proving session resolution is auth-keyring-independent. [src/auth/runtime.rs:971](/Users/ccheever/projects/snapback/src/auth/runtime.rs:971) Scoped agent tokens similarly resolve from copied hashes and grant rows, independently of the auth incarnation. [src/storage/auth_agent_credentials.rs:798](/Users/ccheever/projects/snapback/src/storage/auth_agent_credentials.rs:798) Resume tokens do not consult the auth incarnation at all; they use `appId`, manifest generation, data-version-stream identity, and a separate `resume-keyring.json`. [src/local.rs:13349](/Users/ccheever/projects/snapback/src/local.rs:13349), [src/local.rs:18498](/Users/ccheever/projects/snapback/src/local.rs:18498) **Resolution:** define one transactional fork scrub/mint operation that terminalizes or deletes copied sessions and token families, revokes copied agent grants/tokens, rotates both auth and data-stream identities, gives the fork a fresh resume keyring, and proves that parent session, refresh/logout, scoped-agent, search-cursor, and resume credentials all fail.

3. **Blocker — §Asset plane and F0 are incompatible with the current local asset layout.** The filesystem store is rooted at the database’s parent directory, so databases in the same directory share `assets/`; databases in different directories do not share any bytes. [src/local.rs:6498](/Users/ccheever/projects/snapback/src/local.rs:6498), [src/assets.rs:1877](/Users/ccheever/projects/snapback/src/assets.rs:1877) Physical keys are opaque UUIDs, not content-digest-derived paths. [src/assets.rs:1900](/Users/ccheever/projects/snapback/src/assets.rs:1900) Therefore the proposed default has no safe current mapping: a separate-directory fork receives metadata pointing at absent blobs, while a same-directory fork shares a store that `app.reset` can wipe wholesale and whose GC can delete bytes based only on the fork’s metadata. [src/local.rs:5200](/Users/ccheever/projects/snapback/src/local.rs:5200) The independent asset runner and GC also start unless separately disabled. [src/server.rs:16638](/Users/ccheever/projects/snapback/src/server.rs:16638) **Resolution:** asset safety must move into F0. Either reject asset-bearing forks, reflink/copy a fork-private asset store, or implement a fork-aware shared-store identity and GC barrier before any fork boots. Add destructive reset/drop/GC tests across parent and fork.

4. **Blocker — the rogue-agent blast-radius claim has no matching threat boundary.** A forked database and a separate process protect against accidental writes routed through the fork, not an agent running as the same OS user. Such an agent can open or delete the parent database, read its config/admin/keyring sidecars, call the parent endpoint, or initiate arbitrary network traffic outside Snapback. LLP 0018 explicitly limits its isolation contract to cooperating apps and gates adversarial isolation on LLP 0009. [LLP 0018 §Isolation contract](/Users/ccheever/projects/snapback/llp/0018-app-instance-boundaries.rfc.md:170) LLP 0097 makes the same distinction. [LLP 0097 §Non-goals](/Users/ccheever/projects/snapback/llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:103) **Resolution:** narrow the local F0 claim to cooperative/accidental isolation, or require a real sandbox boundary—separate UID/container/VM, parent files and endpoint inaccessible, network policy enforced, and no parent capabilities mounted—for the “rogue agent” class.

5. **Major — the runtime quarantine table omits active and privileged escape surfaces.** Cron and jobs flags disable only autonomous claiming; the admin manual cron tick and forced job drain remain functional, while the RFC simultaneously grants the forker admin. [src/cli.rs:3243](/Users/ccheever/projects/snapback/src/cli.rs:3243), [src/cli.rs:3256](/Users/ccheever/projects/snapback/src/cli.rs:3256) Asset maintenance is governed by a third flag, and the general maintenance worker still performs outbound Expo receipt polling. [src/cli.rs:3265](/Users/ccheever/projects/snapback/src/cli.rs:3265), [src/server.rs:16622](/Users/ccheever/projects/snapback/src/server.rs:16622) Admin/agent/MCP surfaces also need an explicit policy: telemetry export is not autonomous egress, but it is a data-export path; manual drains, raw SQL, secret copying, and reset can likewise bypass an overly narrow “handler egress” model. Webhook ingress needs separate callback-routing/deny semantics, and client-side SDK or hosted-checkout traffic remains outside host mediation. **Resolution:** replace the table with an exhaustive matrix covering autonomous workers, manual control-plane actions, handler egress, provider maintenance, ingress/callbacks, client-originated effects, telemetry/export, and unsupported adapters, each with default and proof.

6. **Major — “keeps the appId but is a new logical app” is not coherent under LLP 0018 as written.** LLP 0018 defines a logical app as the unit of schema, functions, storage, auth, secrets, realtime, diagnostics, and admin, then defines `appId` as that stable logical-app identifier that scopes those namespaces. [LLP 0018 §Terms](/Users/ccheever/projects/snapback/llp/0018-app-instance-boundaries.rfc.md:58), [LLP 0018 §Implementation implications](/Users/ccheever/projects/snapback/llp/0018-app-instance-boundaries.rfc.md:302) LLP 0158 instead introduces an unthreaded fork ID while retaining the identifier that 0018 says names the app. “Physically separate” is also currently false for the resume keyring and potentially assets. **Resolution:** either mint a new `appId` and rebind the manifest pair, or define the fork as a derived deployment/instance of the same logical app and introduce a deployment/instance identity that is threaded through credentials, resume/search cursors, local-store keys, admin, backup metadata, telemetry, and endpoints. This requires an explicit 0018/0012 amendment.

7. **Major — the LLP 0097 capability matrix is directionally useful but materially overstates implementation and cost.** The boundary rows for shared schema/functions and cooperating trust are accurate. But `branches.rs` describes itself as an implementation slice, and no server/client path consumes its branch execution or capture types. [src/branches.rs:1](/Users/ccheever/projects/snapback/src/branches.rs:1) Its `MaterializedBase` is a full writable SQLite backup, not merely a lightweight logical overlay. [src/branches.rs:331](/Users/ccheever/projects/snapback/src/branches.rs:331) LLP 0097 itself says the capability must remain `Missing` until exhaustive mediation and acceptance pass. [LLP 0097 §Claim boundary](/Users/ccheever/projects/snapback/llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:103) An implemented 0097 branch could serve cooperating agents that do not diverge schema/functions, but not the stated primary case. Its materialization primitive could nevertheless supply most of the storage half of a heavy fork. **Resolution:** distinguish “accepted design,” “implemented substrate,” and “product-wired capability” in the matrix; correct the cost row; and make the fold alternative a shared snapshot/materialization engine plus a separately specified instance-identity/quarantine layer.

8. **Major — `src/instance_lock.rs` does not substantiate the live-parent checkpoint story.** The lock provides exclusive ownership and records PID/URL metadata; it has no checkpoint or clone primitive. [src/instance_lock.rs:36](/Users/ccheever/projects/snapback/src/instance_lock.rs:36) A live host operation would require new authorization, destination-path validation, commit coordination, checkpoint failure handling, registry updates, and crash cleanup. Conversely, the 0097 materialization code already uses SQLite’s backup API to obtain a consistent snapshot while the source advances. [src/branches.rs:356](/Users/ccheever/projects/snapback/src/branches.rs:356) **Resolution:** specify the actual consistency algorithm and crash boundaries. Reuse the backup primitive if full-copy performance is acceptable, or prove a quiesce/checkpoint/clone protocol that holds the correct write gate and handles WAL readers and partial destinations. Do not call the live path “milliseconds” before measuring it.

9. **Major — “no secrets copied” is too broad without a custody inventory.** The LLP 0036 config-value claim is verified, but SQLite still contains security-sensitive capability material: session/scoped-token validators, push device token bytes, and asset signing-key material. [src/push.rs:769](/Users/ccheever/projects/snapback/src/push.rs:769), [src/assets.rs:964](/Users/ccheever/projects/snapback/src/assets.rs:964) Relevant sidecars include the per-database auth keyring, directory-wide resume keyring, telemetry store, and admin token; an inherited `SNAPBACK_ADMIN_TOKEN` also suppresses fresh auto-minting. [src/auth/keyring.rs:125](/Users/ccheever/projects/snapback/src/auth/keyring.rs:125), [src/telemetry.rs:1871](/Users/ccheever/projects/snapback/src/telemetry.rs:1871), [src/admin.rs:480](/Users/ccheever/projects/snapback/src/admin.rs:480) **Resolution:** add a fork custody manifest enumerating every DB-resident credential and sidecar, with an explicit `copy`, `scrub`, `rotate`, `share`, or `refuse` rule. Unknown custody classes should fail fork creation.

10. **Major — the diff receipt cannot show “exactly what [a rogue agent] did.”** `_snapback_changes` covers journaled app-data changes, but auth state explicitly bypasses app journals, receipts, versions, and live delivery. [src/local.rs:4004](/Users/ccheever/projects/snapback/src/local.rs:4004) It also omits sidecars, asset-file operations, telemetry, external attempts, and potentially privileged maintenance or raw-SQL changes. Comparing the current parent and fork with `sqldiff` would additionally conflate changes made independently on the parent unless the immutable base snapshot is retained. **Resolution:** describe the journal receipt as an app-row diff only; retain a baseline for whole-SQLite comparison and combine it with operation logs, captured-effect records, subsystem ledgers, sidecar custody changes, and explicit coverage/omission metadata.

## 5. Suggestions

- Rename the capability after the identity decision: “derived deployment” may be more accurate than “new logical app” if `appId` remains unchanged.
- Split capability reporting into at least `DataIsolated`, `HostEgressMediated`, and `ProcessContained`; none implies the next.
- Make the first spike intentionally narrow: stopped parent, no assets, no copied credentials, all network denied, local-only.
- Turn the quarantine inventory into a checked registry so new outbound adapters cannot land without declaring fork behavior.
- Keep search index data inside the ordinary database-copy path; its durable tables are already SQLite-resident. Rotate the data-stream identity so copied search cursors cannot cross instances.
- Replace “days, not weeks” with estimates after the egress and identity bypass corpus exists.

## 6. Open questions

- Is the primary consumer a cooperative coding agent pointed at the wrong-backend-safe clone, or an actually untrusted process? Those require different products.
- Is a fork a new logical app, a new deployment of the same logical app, or a child in an explicit app lineage?
- Should copied user records retain identities while all sessions, agent grants, push registrations, and impersonation capabilities are removed?
- For local assets, is the intended model fork-private reflinked bytes, a fork-aware shared store, or “asset-bearing apps unsupported in F0”?
- Where does authoritative fork registry state live when the parent is offline, replaced, or deleted, and how are two-sided stamps made crash-consistent?
- What specific repository workflow or demo will be the named first consumer required by the RFC’s own graduation criteria?

## 7. Recommended next step

Do not begin with the CLI verb. First revise LLP 0158 to choose an identity model and threat model, downgrade the 0097 implementation claims, and move asset safety into F0; then build a quarantine/identity spike using the existing SQLite backup primitive. Its acceptance corpus should prove rejection of parent session, scoped-agent, resume, search-cursor, admin, and asset capabilities; capture or refusal of `ctx.fetch`, `fetchStream`, push send/receipt polling, manual cron/job dispatch, and every provider adapter; isolation across reset/drop/GC; and explicit behavior for webhooks, admin/MCP, telemetry export, and client-originated effects. Only after that corpus passes—and a named schema-divergent consumer is pinned—should the RFC graduate toward Review or estimate F0.

---

## Round 2 — 2026-08-03

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli`, `codex exec`, model `gpt-5.6-sol`,
`model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh `codex exec` context over the working tree at 50ff432a,
given a summary of the round-1 convergent defects (not the artifacts) and
asked to disposition each against the revised document, hunt fix-introduced
defects, and spot-check the revision's new code citations. The document
advanced from v0.4 to v0.5 during the review (the reviewer noted the moving
target; round 3 will run against stable bytes). Author verification before
application: the novel citations were checked and are accurate —
`SNAPBACK_ASSET_STORE=s3` selects the S3 store configured from
`SNAPBACK_ASSET_S3_*` environment credentials (src/local.rs:6469,
src/assets_s3.rs:47); asset signing material is DB-resident and
`signed_url_input` MACs (asset, variant, grantee, generation) with no
instance identity (src/assets.rs:2560–2570); the resume keyring is
directory-scoped (`dir.join("resume-keyring.json")`, src/local.rs tests);
`_snapback_jobs_v1` does not appear in storage.rs's reset deletion
sequence (managed in src/jobs.rs), confirming the app.reset checklist
claim was false.

---

## Overall assessment

I reviewed the current workspace version in full; it advanced from the requested v0.4 to v0.5 during review (SHA-256 `901b9fb2…45b3`). The revision substantially improves the threat model, live-copy design, diff scope, and LLP 0097 relationship. The named code citations are accurate except for the new claim that `app.reset` provides an exhaustive system-table checklist.

## Verdict

**NOT READY** — the scrub-and-mint lacks a crash-safe publication protocol, while the claimed closed custody and egress inventories remain incomplete.

## Round-1 defect disposition

- Identity mint — **partial** — §Design sketch correctly replaces rotation with scrub-and-mint, but its cross-file transaction and inventory are not soundly specified.
- Effect capture and egress seams — **partial** — §Relationship to LLP 0097, §Runtime plane, and §Implementation path honestly mark the substrate unwired and enumerate multiple families, but omit asset-provider egress.
- Asset storage and custody — **partial** — §Asset plane corrects the physical-layout claim and makes custody an F0 decision, but private-tree consistency and signing-key custody remain incomplete.
- Rogue-agent containment — **resolved** — §Threat model clearly limits local F0 to runtime-mediated safety and assigns malicious-process containment to OS isolation.
- `appId` semantics — **partial** — OQ9 correctly reopens the issue, but several normative sections still assert that the fork is a new logical app.
- Live-parent consistency — **resolved** — §The copy and §Implementation path use the real SQLite backup primitive in [`MaterializedBase`](/Users/ccheever/projects/snapback/src/branches.rs:355).
- Diff-receipt coverage — **resolved** — §Diff surface explicitly limits the journal receipt to app rows and lists omitted planes.

## New concerns

1. **[blocker] Scrub-and-mint is not transactionally defined across the database and sidecars.** The RFC calls it “one transactional operation” over DB state, keyrings, admin token, and stamps ([RFC line 309](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:309)), but gives no staging marker, non-runnable state, atomic publication step, or crash-cut tests. A raw clone is bootable and initially accepts copied credentials, while the resume keyring is directory-scoped—not database-scoped ([local.rs](/Users/ccheever/projects/snapback/src/local.rs:18498)). F0a needs a protocol such as clone-to-unpublished-location → transactional DB scrub/stamp → fresh sidecars → atomic ready publication, with startup refusing unstamped forks.

2. **[major] The new `app.reset` “every system table” citation is false.** Its deletion sequence ([storage.rs](/Users/ccheever/projects/snapback/src/storage.rs:938)) omits durable-job tables such as `_snapback_jobs_v1`, attempts, and push grants ([jobs.rs](/Users/ccheever/projects/snapback/src/jobs.rs:306)). Since exhaustive custody is a safety invariant, the inventory must come from an authoritative registry or schema sweep, not this incomplete precedent.

3. **[major] The closed egress set omits provider-backed asset I/O.** `SNAPBACK_ASSET_STORE=s3` selects an S3 store using inherited environment credentials ([local.rs](/Users/ccheever/projects/snapback/src/local.rs:6469)), and its transport performs direct HTTP ([assets_s3.rs](/Users/ccheever/projects/snapback/src/assets_s3.rs:47)). Disabling the asset maintenance runner does not mediate request-path delivery or other asset-store operations. Asset-provider calls and their environment credentials need an explicit capture/refuse classification and F0a bypass tests.

4. **[major] Asset option (b) lacks a live-parent consistency and bearer-custody rule.** SQLite backup plus a separately reflinked asset directory is not one consistent cut; the existing export path already demonstrates the necessary pattern of capturing referenced rows and verifying immutable blobs ([local.rs](/Users/ccheever/projects/snapback/src/local.rs:7620)). Additionally, signing keys are copied DB material ([assets.rs](/Users/ccheever/projects/snapback/src/assets.rs:830)), and signed-URL MAC input does not bind an app or fork identity ([assets.rs](/Users/ccheever/projects/snapback/src/assets.rs:2566)); option (b) must rotate those keys and test parent signed URLs against the fork.

5. **[major] OQ9 contradicts stale normative text.** OQ9 correctly says the identity model blocks F0 ([RFC line 801](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:801)), but §Relationship to LLP 0097, §Why this is still not LLP 0088, §Non-goals, and the operation signature still call the fork a “new logical app” ([RFC line 239](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:239), [line 255](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:255), [line 290](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:290)). Those claims must remain identity-neutral until OQ9 resolves LLP 0018’s namespace semantics.

6. **[minor] Two copy claims remain overbroad.** The Summary still says SQLite copying is “nearly free,” although only cold APFS `clonefile` was measured ([RFC line 87](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:87)); the spike itself is properly scoped. The diff fallback also says the live path retains an immutable base ([RFC line 519](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:519)), but the materialized destination becomes the writable fork unless a separate retained base is specified.

## Recommended next step

Prepare v0.6 before starting F0a: define crash-safe mint publication and unique sidecar placement; replace the `app.reset` checklist with an authoritative custody inventory; add jobs, asset signing keys, signed URLs, and S3/provider operations to that inventory and safety corpus; specify a consistent asset copy cut or choose refusal for F0; and make all pre-OQ9 language identity-neutral. Then rerun round-2 review against stable bytes.

---

## Round 3 — 2026-08-03

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli`, `codex exec`, model `gpt-5.6-sol`,
`model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh `codex exec` context over the working tree at 50ff432a,
reviewing the v0.6 bytes (the reviewer noted the file began changing
concurrently — the v0.7 Fable-round-3 touch-up — and scoped its
assessment to v0.6; the v0.7 deltas independently fixed this round's
major, see below). Dispositioned its own round-2 findings and hunted
fix-introduced defects in the v0.6 additions.

## Verdict

**NOT READY** (on two items; four of six round-2 findings resolved).

## Round-2 disposition (as returned)

1. Crash-safe publication — **partial**: quarantine stamp, transactional
   mint, separate-directory sidecars, startup refusal, and crash cuts
   added, but a clone-before-stamp bootable window remained and the
   atomic registry-row-plus-rename claim was impossible.
2. app.reset completeness — **resolved** (mechanical sweep).
3. S3/provider egress — **resolved** (matrix row + F0a leg).
4. Asset option (b) — **resolved** (same-cut + signing-key obligations,
   supported by src/assets_cut.rs and src/assets.rs).
5. Identity-neutral language — **partial**: §Non-goals still said a
   retained fork "is an ordinary logical app."
6. Copy-cost claims — **resolved**.

## New concerns (as returned)

1. **[BLOCKER]** The publication fix does not make an unminted clone
   unbootable: the destination is a complete bootable database before
   the in-database stamp is written, and `snapback start --db` accepts
   arbitrary paths, so "unpublished" is not a boot prohibition; a
   filesystem rename and a registry-row transaction cannot form one
   atomic operation. Required: a refusal authority established before
   cloning (e.g., a staging-directory sentinel checked by startup) and a
   two-phase, recoverable publication with one authoritative commit
   point.
2. **[MAJOR]** OQ9's derived-deployment branch conflicts with LLP 0018's
   one-stream-per-logical-app rule; the amendment consequences must
   include widening stream ownership to per-instance. *(Author note:
   Fable round 3 independently returned the same finding the same day —
   convergent across families — and the v0.7 touch-up had already
   applied it before this review returned.)*

## Recommended next step (as returned)

Keep the RFC Draft; revise the publication protocol around a pre-clone
quarantine authority plus recoverable two-phase publication with crash
cuts before the DB stamp and between rename and registry reconciliation;
extend OQ9 to version-stream ownership; remove the "ordinary logical
app" residue; freeze a byte-identifiable revision and rerun before F0a.

*(Author note: the v0.8 revision applied all of the above the same day;
round 4 runs against frozen bytes
81e11dc2055f200c15065a823c307568dd23dc65ebe07f12c2c108ad3cb7c7f3.)*

---

## Round 4 — 2026-08-03

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli`, `codex exec`, model `gpt-5.6-sol`,
`model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh `codex exec` context over the working tree at 50ff432a,
against the frozen v0.8 bytes (hash verified by the reviewer). A v0.9
touch-up (Fable round-4 sentinel-ordering and same-filesystem pins)
landed mid-review and is disclosed here; it partially overlapped this
round's findings.

## Verdict

**NOT READY** (v0.8 bytes).

## Round-3 disposition (as returned)

- BLOCKER — **not resolved**: pre-clone refusal and rename-as-commit are
  good corrections, but the committed directory remains sentinel-bearing
  and its database remains refusal-stamped with no transition to a
  bootable published state; clearing either before the rename risks
  reopening the window unless an explicit state machine governs both.
- MAJOR (OQ9 stream widening) — **resolved** (via the v0.7 touch-up;
  independently convergent with Fable round 3).
- Non-goals residue — **resolved**.

## New concerns (as returned)

- **MAJOR** — "POSIX gives us" atomic rename requires same-filesystem
  staging, and crash durability needs an explicit fsync order for the
  database, sentinel, renamed directory, and parent directories.
- **MINOR** — startup-refusal language should be framed explicitly as
  required F0 behavior, not as something that exists in code.

## Recommended next step (as returned)

Specify the complete publication state machine — sentinel
placement/removal, quarantine-versus-lineage stamp transitions,
same-filesystem placement, durability ordering, reconciliation, and
post-recovery boot assertions — then rerun.

*(Author note: the v0.10 revision applied exactly this the same day —
six-state machine with quarantine→lineage stamp conversion inside the
mint transaction, per-state fsync points, recovery rules, post-recovery
boot assertion, and F0-work framing. Codex round 4 and Fable round 4
independently converged on the sentinel-ordering and same-filesystem
pins — the loop's second convergent cross-family finding.)*

---

## Round 5 — 2026-08-03

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli`, `codex exec`, model `gpt-5.6-sol`,
`model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh `codex exec` context over the working tree at 50ff432a,
against frozen v0.10 bytes (hash verified by the reviewer; no concurrent
edits this round). Adversarial walk of the six-state publication machine.

## Verdict

**NOT READY** (v0.10 bytes) — but the round-4 **blocker is RESOLVED**
("mint atomically converts quarantine to lineage, and reconciliation
removes the sentinel only after registry finalization"); the remaining
findings are durability-depth majors.

## Round-4 disposition (as returned)

- BLOCKER — **resolved** (quarantine→lineage conversion +
  clear-after-finalization).
- MAJOR (same-filesystem + fsync) — **partial**: placement pinned,
  fsync protocol incomplete.
- MINOR (F0-work framing) — **resolved**.

## New concerns (as returned)

1. **MAJOR** — S2 fsyncs the database and directory but not each minted
   sidecar's contents or the SQLite WAL/journal durability set; a
   durable lineage stamp could outlive missing/truncated mint artifacts.
2. **MAJOR** — S4 fsyncs only the destination parent; a cross-directory
   rename needs both parents fsynced — the durable commit point is
   rename-plus-directory-fsync, not rename alone.
3. **MAJOR** — F0a's crash cuts are state-boundary sampling; intra-state
   cuts (sidecar writes, DB/WAL flush, rename vs fsync, registry
   finalization, sentinel unlink) are missing.
4. **MAJOR** — recovery assumed an authoritative reconciler even when
   the parent registry is unavailable or deleted (OQ10 interaction).

## Recommended next step (as returned)

Specify the exact ordered durability operations and registry/discovery
authority, then expand F0a into an intra-state crash-cut matrix with
post-recovery boot assertions.

*(Author note: the v0.11 revision applied all four the same day —
completed S2 durability set, rename-plus-both-parents-fsync commit,
intra-state crash-cut matrix, and local-evidence-only recovery with the
registry demoted to advisory bookkeeping (OQ10 narrowed to bookkeeping).
Round 6 runs against frozen bytes as the loop's closing round.)*

---

## Round 6 — 2026-08-03 (closing round)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli`, `codex exec`, model `gpt-5.6-sol`,
`model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh `codex exec` context over the working tree at 50ff432a,
against frozen v0.11 bytes (SHA-256
c2747e55544debee0a08427aaf427b0f0f2dca885098f9560992c922cd188bc8,
verified by the reviewer; no concurrent edits). Closing-round calibration
was given explicitly: design-altitude judgment, with implementation-depth
residue delegated to F0a rather than blocking.

## Verdict

**READY** for graduation toward Review/F0a. "v0.11 now presents a
coherent, fail-closed publication protocol; all four round-5 durability
majors are resolved at RFC altitude, with implementation proof correctly
assigned to F0a. OQ9 remains a stated graduation/shipping gate, but does
not prevent beginning F0a."

## Round-5 disposition (as returned)

- S2 durability set — **resolved** (complete WAL/journal set, every
  minted sidecar's contents, staging directory, stamp/artifact ordering
  invariant).
- Durable publication commit — **resolved** (rename plus both-parent
  fsync, sound same-parent optimization).
- F0a crash coverage — **resolved** (intra-state crash-cut matrix with
  post-recovery boot assertions is the controlling requirement).
- Registry-independent recovery — **resolved** (lineage stamp + mint
  receipt + sentinel are authoritative local evidence; registry advisory;
  OQ10 appropriately narrowed).

## Residual items explicitly delegated to F0a (as returned)

- Materialize and validate the exact SQLite-mode-specific file,
  WAL/journal, sidecar, and directory-fsync ordering.
- Exercise every intra-state cut, including rename vs each directory
  fsync and sentinel unlink vs its parent-directory fsync.
- Prove recovery and boot behavior with the registry absent, stale, or
  unavailable.
- Run the credential, cursor, asset-URL, and egress capture-or-refuse
  negative corpus already specified.

## Recommended next step (as returned)

Begin F0a using the stronger intra-state matrix as controlling scope,
while resolving OQ9 before F0 can ship or the RFC can complete
graduation.

---

## Loop summary (author-recorded)

Six rounds, 2026-08-03, converged **dual-family READY**: Fable READY at
rounds 2, 3, and 4 (protocol scope); Codex READY at round 6 after a
strictly shrinking defect set (round 1: 4 blockers + 6 majors; round 4:
1 blocker; round 5: durability majors; round 6: clean). Two convergent
cross-family findings (OQ9 stream-clause widening, rounds 3;
sentinel-ordering/same-filesystem, rounds 4). One author fix-introduced
error caught (the app.reset checklist claim). Final bytes v0.11. Status
transitions remain the author's; the reviewers' shared next step is:
decide OQ9, then begin F0a.


## Round 2 — 2026-08-06 (Review-status acceptance loop)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli`, `codex exec`, model `gpt-5.6-sol`,
`model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-06 (commissioned 2026-08-05)
**Redacted:** no
**Method:** fresh non-author `codex exec` context over the working tree at
a3cced745 (Status already `Review`); instructed to verify the document's
claims against `src/instance_fork.rs`, the fork sections of `src/cli.rs`,
and the fork test corpus, with file/line citations required for every code
claim. Orchestrated by the Claude session executing LLP 0185 (which
authored the recent revisions and therefore does not count itself as an
independent reviewer for them).

### Review as received

VERDICT: NOT-READY

1. BLOCKER — §Design sketch, crash recovery (`llp/0158-instance-forking.rfc.md:573-586`). The RFC claims recovery is exact-destination and local-evidence-bound. In fact, when the destination is absent, `recover` deletes every root entry whose name merely starts with `.<destination>.staging-`, without validating a sentinel, UUID suffix, receipt, lineage, or acquiring a lifecycle lock (`src/instance_fork.rs:3033-3047`). Active publication uses that same prefix (`src/instance_fork.rs:2729-2737`), so recovery can delete an unrelated or concurrently active create. The CLI’s direct-child validation does not close this widening (`src/cli.rs:3243-3267`).

2. BLOCKER — 2026-08-05 Phase 5 claim and §Implementation path (`llp/0158-instance-forking.rfc.md:23-31`, `:956`). The RFC claims crash-safe, same-cut private asset custody with no possible metadata-only publication. The implementation creates `staging/assets/blobs` and `staging/assets/staging` (`src/instance_fork.rs:2854-2858`), syncs each blob and the `blobs` directory (`src/instance_fork.rs:2909-2915`), then syncs only the top-level staging directory (`src/instance_fork.rs:2780-2785`). It never syncs `staging/assets`, whose directory entries bind the nested `blobs` tree. Thus the code does not establish the claimed power-loss durability before rename. The asset test is functional only (`src/instance_fork.rs:3137-3165`), while the crash matrix has no asset-copy cuts (`src/instance_fork.rs:4780-4801`).

3. BLOCKER — §Automation-facing artifact inventory (`llp/0158-instance-forking.rfc.md:1063-1089`). The claimed frozen, complete projection says “all seven operations,” but the implementation has eight: `Renew` is a CLI operation (`src/cli.rs:1358-1370`) emitting `fork.renew` with receipt and registry (`src/cli.rs:3184-3205`). Its durable `fork-renew-intent.json`, `fork-renew-receipt.json`, and `ForkRenewReceiptV1` are also absent from the inventory (`src/instance_fork.rs:20-21`, `:759-769`). Other omitted implemented fields include create’s `automaticReap.clearedStaleRegistryIds` and `resourceAdmission` (`src/cli.rs:2960-2972`), list’s `unboundRegistry` and `resourceUsage` (`src/cli.rs:3030-3040`), reap’s `clearedStaleRegistryIds` (`src/cli.rs:3230-3233`), and the `--net` receipt alternative (`src/cli.rs:3133-3142`). This fails LLP 0185 Phase 0’s artifact-freeze requirement (`llp/0185-instance-forking-productization.plan.md:217-227`).

4. MAJOR — §Stable diagnostics (`llp/0158-instance-forking.rfc.md:1184-1231`). The table claims to enumerate every `SNAPBACK_FORK_*` spelling in the primary files, but omits `SNAPBACK_FORK_NET_DIFF_UNAVAILABLE`, `SNAPBACK_FORK_ASSET_CUT_INCOMPLETE`, `SNAPBACK_FORK_ASSET_CUT_UNSUPPORTED`, and `SNAPBACK_FORK_DIFF_ORACLE_MISMATCH`, all defined in source (`src/instance_fork.rs:32-35`) and emitted by live paths (`src/instance_fork.rs:2475-2479`, `:2592-2603`, `:2860-2907`). It also misdefines `SNAPBACK_FORK_CUSTODY_REFUSED` as including asset-bearing sources (`llp/0158-instance-forking.rfc.md:1194`); supported local assets are now classified `Copy` (`src/instance_fork.rs:381-429`), while unsupported asset cuts use the newer asset diagnostics.

5. MAJOR — §Runtime plane (`llp/0158-instance-forking.rfc.md:679`, `:688-690`). The RFC says every quarantine default is explicitly overridable and that inherited `SNAPBACK_ASSET_S3_*` credentials are custody-manifest entries. Neither is implemented. Custody is assembled only from classified database tables, known sidecars, and the optional config sibling (`src/instance_fork.rs:967-975`). Fork launch removes only `SNAPBACK_ADMIN_TOKEN`, while otherwise inheriting the process environment (`src/cli.rs:2827-2842`). S3 safety comes from an unconditional derived-fork egress denial before provider construction (`src/local.rs:6680-6688`), not credential scrubbing or an opt-in override; even the experimental S3 switch is evaluated only after that denial (`src/local.rs:6693-6699`). Worker disabling is likewise unconditional for derived forks (`src/cli.rs:6046-6079`). The DB/session/sidecar scrub itself is implemented (`src/instance_fork.rs:895-1004`), but the RFC misstates ambient credential custody and override behavior.

6. MAJOR — §Motivation item 4 and §Non-goals (`llp/0158-instance-forking.rfc.md:340-344`, `:456-460`). These older sections say an operator can promote a checkpoint and that nothing prevents keeping a fork alive indefinitely. Current code stamps `promotable: false` (`src/instance_fork.rs:917-925`) and rejects promotable lineage at boot (`src/instance_fork.rs:1118-1127`). Creation is capped at seven days (`src/instance_fork.rs:43`, `:1463-1475`), and renewal rejects expiry beyond that lifetime (`src/instance_fork.rs:2079-2089`). The newer lifecycle text correctly says promotion and permanent forks are separate products (`llp/0158-instance-forking.rfc.md:843-856`), so these reader-facing use-case/non-goal claims directly contradict the implemented contract. Process-containment and hosted nonclaims are otherwise adequately explicit at `llp/0158-instance-forking.rfc.md:718-726` and `:1272-1276`.

7. MAJOR — §Implementation path F0a/F0b and OQ5 (`llp/0158-instance-forking.rfc.md:1013-1015`, `:1022-1031`, `:1363-1368`). These sections still say asset-bearing parents refuse and private copying remains future work. Current publication always invokes private asset copying (`src/instance_fork.rs:2771-2782`); supported local-fs blobs are digest/length checked and copied (`src/instance_fork.rs:2822-2915`). This contradicts both the 2026-08-05 revision note and the current implementation inventory.

8. MAJOR — Status metadata versus §Status (`llp/0158-instance-forking.rfc.md:4`, `:241-246`, `:1432-1454`, `:1498-1500`). The metadata says `Review`, but the banner and Status section repeatedly call the RFC `Draft`, say it remains Draft, and propose a future Draft-to-Review transition. LLP 0185 confirms that the transition already occurred (`llp/0185-instance-forking-productization.plan.md:9-10`). The formal state is therefore internally contradictory at the point acceptance is being considered.

### Orchestrator disposition — 2026-08-06

All eight findings verified against code before acting; every one was real.

- **Finding 1 (staging-reap widening): FIXED in code.** `recover` now reaps
  only directories whose suffix parses as a UUID **and** which carry the
  staging sentinel (a sentinel-less empty shell may be removed; anything
  non-empty and unproven stays). The remaining active-publication race is
  now documented at the reap site: `recover` is a repair verb for a
  destination with no live publisher.
- **Finding 2 (missing `assets/` fsync + no asset crash cuts): FIXED in
  code.** The durability chain staging → assets → blobs now syncs every
  level; `PublicationCut::AfterAssetCopy` was added and the whole 21-cut
  publication crash matrix now runs over an asset-bearing parent.
- **Findings 3–8 (inventory, diagnostics table, runtime-plane framing,
  stale Motivation/Non-goals/OQ5/F0 text, Status contradictions): FIXED in
  the document** — renew and the `--net` receipt joined the operation
  inventory with their durable artifacts, the four 2026-08-05 diagnostics
  joined the table with a corrected `CUSTODY_REFUSED` gloss, the
  runtime-plane table now states the implemented unconditional gates and
  env-inheritance posture, the promotion/indefinite-lifetime/asset-refusal
  claims were reconciled with the implemented contract, and every
  Draft-era status self-reference now records the 2026-08-05 Review
  transition.

Proposed next step per LLP 0005: the fixes were applied by the
orchestrating session, not re-verified by this reviewer family; a delta
re-review of the revised document (or the author's own read of this
disposition) is the honest gate before acceptance.
