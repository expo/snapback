# Review artifact — LLP 0226 (identity architecture) — claude family

Target: `llp/0226-identity-architecture.decision.md`
Loop: llp-super-refine 2026-08-10, independent-loop topology, orchestrated by
Claude Fable 5 (session 0f56679e); reviser = orchestrator.

## Round 1 — 2026-08-10

- Reviewer: claude family — fresh general-purpose subagent, model
  claude-fable-5 (session model), no shared context with the orchestrator's
  revisions or the other family.
- Capsule: detached worktree at commit `1c19e047b` (structural exclusion of
  `llp/reviews/0226*` — none exist at that commit; no-reviews/no-worktree
  instruction residue self-attested).
- Target revision: (b), sha256
  `584bcda0c9308e452e8525ad352f5b878d5a6608b68d1d4262d12922dceb6797`.
- Instructions: sr-review-r1 template, sha256
  `cddeabc21d877f2880953c1916ae3be39776d03741b41f83b99cfd131e1709c6`.
- Verdict: **NOT READY** (1 MATERIAL concern; binds to the capsule/target
  hashes above).

### Verbatim review

**1. Summary**

LLP 0226 executes Charlie's 2026-08-08 OQ2 ruling: one coordinating Decision fixing the identity vocabulary (eight namespaces with provenance/uniqueness/mutability), six conversion rules (C-1–C-6), five mint-conformance rules (M-1–M-5), an explicit clearance of LLP 0135's two fences for the serial-column case only, and three owner-amendment lanes. The structure, the fence clearance, the schema-lane content, and the settlement lane are all accurate against the repository and the ruling trail. The direction is right. One MATERIAL defect remains: the auth-identity namespace row — the vocabulary this Decision exists to fix — conflates the Snapback-minted principal (account) with the provider credential identity, and its immutability/provenance/stored-key claims contradict the implemented and governed auth model (LLP 0011/0057/0151) and the very recipe C-2 cites as conforming.

**2. Direction assessment**

The central idea — vocabulary-and-conformance Decision, implementation distributed to the owners that already govern each surface — is not only sound, it is the structure the author already ruled (LLP 0191 "Author rulings" #2, verified at `llp/0191-*.md` lines 525–530) and the ticket commissioned (`issues/20260808-identity-architecture-decision.md`). The document adds real value beyond restating the ruling: the namespace table makes the "shared vocabulary, different trust domains" diagnosis of LLP 0191 §3 actionable, C-2/C-4 encode the two genuine security boundaries (binding-writer-holds-both-sides; settlement digest, never raw `clientMutationId`), and §4 does the one thing only a Decision can do — explicitly clear an Accepted Spec's fences (LLP 0135 §1.1 "no authored start", §1.9 "any cross-scope or global counter"), narrowly, exactly as LLP 0007's 2026-08-08 amendment anticipated (`llp/0007-storage-portability.spec.md:903-983`). The schema lane transcribes the wholesale-endorsed groundwork faithfully (`issues/shelved/20260808-numeric-identity-default-columns.md`, "Author ruling — 2026-08-10"). This is the right document solving the right problem.

**3. Concerns**

**Concern 1 — The auth-identity namespace conflates principal and provider identity, and its mutability/provenance/stored-key claims contradict the governed model. MATERIAL.**

Text at issue: §1's row "Auth identity (principal) | Session mint; anchored to the provider's immutable `(issuer, subject)` pair | One auth provider installation | Immutable anchor … | `v.principal()`, `ctx.auth.userId`", restated in §3(b) and C-6 ("The stored key is … `(issuer, subject)` for auth identity").

Evidence:
- The implemented substrate has **two** distinct things, in two tables: `_auth_users` (stable Snapback-minted principal/account ids — this is what `ctx.auth.userId` carries) and `_auth_identities` (provider credentials, `(provider, subject)` unique, many rows per user via `user_id` FK) — `llp/0057-auth-provider-protocol.spec.md:415-437`. LLP 0151 confirms: "stable Snapback-issued principal ids, `_auth_identities` linking `(provider_key, external_subject) → principal`" (`llp/0151-first-party-identity-integrations.rfc.md:133-136`).
- The principal-to-credential association is **mutable by design**: LLP 0151's lifecycle rules include link, unlink, identifier replacement, and the last-authenticator rule, and it explicitly notes "LLP 0039 already flags identity-subject change as pressure on the `(provider, subject)` model; those flows land here" (`llp/0151:380-406`). So "Immutable anchor" is false for the principal; it is true only for the credential row itself.
- The row's cells describe different objects: uniqueness scope "one auth provider installation" fits `(provider, subject)` in `_auth_identities`; the surface `ctx.auth.userId` is `_auth_users.id`, whose uniqueness is instance-wide and provider-independent. Provenance "session mint" fits neither — the principal id is minted at account creation, the credential by the provider.
- C-6 names `(issuer, subject)` as *the* stored key for auth-identity conversions, but the conforming recipe C-2 itself cites keys the app binding on the **principal**: `guide/auth/app-identity-binding.md:25` ("`ctx.auth.userId`, a server-minted principal id"), lines 57–64 (`principal: v.principal()`, unique `by_principal`).

Why this is MATERIAL rather than detail: this is a vocabulary Decision, and the auth row is decided vocabulary the auth/D7 owner amendment must conform to. An implementer following C-6 literally could key a binding or claims projection on `(issuer, subject)`; under 0151's identifier replacement or unlink/relink, the account keeps its principal but changes its credential, silently orphaning or misdirecting the binding — exactly the class of plausible-but-wrong guess the author asked reviewers to catch.

Fix: split the row into two namespaces — **Principal (account identity)**: Snapback mints at account creation; one instance; the id value is immutable but its linked credential set is mutable (LLP 0151 lifecycle governs); surface `ctx.auth.userId` / `v.principal()`; the stored key for app-side conversions (C-2). And **Provider identity (credential)**: provider mints `(issuer, subject)`; unique per provider installation; immutable as a credential; lives in the auth substrate (`_auth_identities`) and is the stored key *inside* that substrate — never email (C-6's actual point, which survives intact). Reword §3(b) and C-6 accordingly.

**Concern 2 — The incarnation-prefix rule is asserted for a scope where it is currently undefined. Implementation-phase.**

§1's serial row ("One table within one instance incarnation, under LLP 0110's incarnation prefix") and M-3 assert the `(scopeId, relationIncarnation)` prefix applies to serial values. But the prefix as defined (LLP 0135 §1.1, `llp/0135:225-273`) is anchored to a **scope row's** relation incarnation in LLP 0110's registry; a table-scoped counter has no scope row, so what carries the incarnation (and whether one is needed — note LLP 0007's removed-table dormancy: "reset clears dormant removed tables", `llp/0007` header amendments) is undefined until the successor profile defines it. The Decision defers physical layout, so this is settleable in the schema-owner amendment — but the text should say "as the successor profile defines for table scope" rather than asserting the row-scoped rule applies as-is. Relatedly, "instance incarnation" (also in the row-identity row) is not a defined corpus term; LLP 0110 defines *relation* incarnations and LLP 0158 defines fork/derived-deployment identity. A vocabulary document should not coin an undefined scope term in its own namespace table.

**Concern 3 — M-4's exhaustion point mixes two different precedents. Implementation-phase.**

M-4 says exhaustion "refuse[s] before the mutation tier … mirroring LLP 0135 §1.5". But LLP 0135 §1.5 refuses *inside* the transaction and rolls the whole transaction back (`SNAPBACK_SEQUENCE_EXHAUSTED`, `llp/0135:432-452`); "refuses before every mutation tier" is the commit-version precedent (LLP 0007's 2026-07-17 amendment). The two are different refusal points, and a serial value allocated during an insert can only follow the §1.5 shape. The ticket carries the same conflated phrasing, so the endorsed groundwork does not resolve it; one sentence in the amendment (or here) picking the §1.5 shape for allocation-time exhaustion would remove the guess.

**Concern 4 — Status metadata is internally inconsistent. Implementation-phase.**

Header line 4 says `Status: Review` and revision (b) records Draft → Review, but the closing "## Status" section (line 255) still says "Draft, 2026-08-10". Editorial; fix before acceptance.

**4. Verifications performed**

- LLP 0191 §3 friction cluster (`W-IDENTITY`, `W-MUTATION-IR`, `W-SHORTID`, settlement identity) and the four-surface revisit: confirmed verbatim (`llp/0191`, lines ~320–395). OQ2 ruled distributed and OQ5's "envelope-early tail" sequencing: confirmed (lines ~525–545).
- Commissioning ticket `issues/20260808-identity-architecture-decision.md`: confirmed — three lanes, one Zerobugs corpus, LLP 0129 keeps IR admission, 2026-08-10 greenlight, Draft pointer.
- Schema-lane transcription vs `issues/shelved/20260808-numeric-identity-default-columns.md` "Author ruling — 2026-08-10": every bullet in §(a) (substrate extension, sequence semantics, server-owned always with stable-code refusal, JS-safe bound, no implicit index, non-empty-table refusal with LLP 0081 `AddField` pointer, `(_createdAt, _id)` backfill successor, `v.serial({ start })`) matches the endorsed groundwork.
- LLP 0135: §1.1 tuple identity, `_snapback_sequence_counters_v1`, "no authored start, step, or format", rejection-with-rationale of a second incarnation/counter authority, uniqueness-prefix rule (`llp/0135:225-281`); §1.5 exhaustion (`432-452`); §1.9 "any cross-scope or global counter" not lifted and "batch allocation (one per invocation in v1)" (`591-606`); open question 2 = multiple allocations per invocation (`1376-1377`). All match the document's citations.
- LLP 0007 dated amendment "closed string domains and the identity-column boundary (2026-08-08)" (`llp/0007:903-983`): anticipates the clearance and requires gap semantics + exhaustion refusal + 0135 relationship — confirmed, restated accurately in §4. (Note: 0007 and the ticket call the serial column "precisely a global counter"; 0226 calls it "table-scoped" — consistent, since 0226 explicitly clears the cross-scope/global fence.)
- Settlement lane vs `issues/closed/20260808-handler-settlement-identity-surface.md`: digest field set `{authFingerprint, authorityInstanceId, clientMutationId, function, inputFingerprint[, operationIssuance]}`, mutation-only refusal, hosted all-null asymmetry, LLP 0043 ownership — all confirmed; `issues/closed/20260808-guide-gap-mutation-settlement-identity.md` is indeed closed.
- `guide/auth/app-identity-binding.md` exists (344 lines) and teaches the broker + frozen-actor-map patterns with three unique indexes and the `bindMe` bypass warning — C-2's characterization is accurate (but see Concern 1 on C-6).
- LLP 0148 `prefix_` + Crockford base32: confirmed (`llp/0148:20,107-125`). LLP 0158 OQ9 "distinguish instances by endpoint + stream identity, not `appId`": confirmed (`llp/0158:816`). `v.principal()` exists on the validator surface (`packages/snapback-codegen/index.mjs:2178-2179`).
- Naming claim: the only `serial` uses found outside docs are hosted-control lifecycle wire keys (`packages/snapback-cli/hosted-control.mjs:75`, `packages/snapback-hosted-supervisor/supervisor-response.mjs:44`) — not the validator surface or schema grammar, so "no conflicting use" holds as scoped.
- M-2 plausibility: system-field writes refuse with a stable code today (`SNAPBACK_SYSTEM_FIELD_WRITE`, `src/data_patch.rs:523`).
- Not verified: LLP 0009/0010/0024 artifact-digest details and LLP 0043/0053 stream-rotation-on-restore specifics were only spot-checked (`versionStreamId` present in 0043; rotation-on-fork confirmed in 0158); I did not trace the restore-rotation claim to its exact section.

**5. Verdict**

VERDICT: NOT READY

## Round 2 — 2026-08-10 (delta round)

- Reviewer: claude family — fresh general-purpose subagent (not the round-1
  reviewer, not the reviser), model claude-fable-5.
- Capsule: detached worktree at commit `0eac1d309` (0 target review
  artifacts present, verified).
- Target revision: (c), sha256 prefix `1184ef4a79ccedaf`.
- Instructions: sr-review-r2 delta template (IN-DELTA vs PRE-EXISTING
  classification mandatory).
- Verdict: **NOT READY** (1 MATERIAL, IN-DELTA; binds to the capsule/target
  hashes above).

### Verbatim review

**Summary**

Revision (c) is a substantial improvement that fixes real defects: the principal/provider-identity split now matches the `_auth_identities` substrate and the guide's binding recipe; the authoritative/speculative row-identity split with C-7 correctly imports LLP 0133's `(mint site, occurrence)` id map; M-3's honest scoping and M-4's pin to LLP 0135 §1.5 both check out against the specs verbatim; and the schema amendment's mandatory question list is well-grounded (the "un-burns on rollback" observation about the current allocator is verifiably true of §1.5's transactional rollback). I verified the delta's load-bearing citations against the checkout and found them accurate with one exception: the rescoping of M-2 carved out Lane Q but left "Lane L row identity" under refuse-on-client-supply semantics, which contradicts LLP 0133's Lane L contract (claims recorded and rederived, never refused) and C-7 in this same document. That is one small-fix material conflict inside the delta; everything else I found is editorial precision.

**Direction assessment**

The direction is right and is not merely plausible — it is the ratified one. LLP 0191 §3's workaround cluster (`W-IDENTITY`, `W-MUTATION-IR`, `W-SHORTID` at lines 329–357 of `llp/0191-scale-architecture-revisits.research.md`), Charlie's 2026-08-08 OQ2 ruling, and LLP 0007's 2026-08-08 amendment (`llp/0007-storage-portability.spec.md:941–978`, which explicitly waits for "the Decision that fixes the identity vocabulary" and dictates the gap-semantics/exhaustion/0135-relationship obligations this document restates) all converge on exactly this shape: one vocabulary-and-conformance Decision, implementation distributed to owner amendments. The schema lane reproduces the ticket's wholesale-endorsed ruling faithfully (`issues/shelved/20260808-numeric-identity-default-columns.md:109–124` — server-owned always, gaps allowed, refuse non-empty tables, `v.serial({ start })`, escape hatch out of v1). The namespace table's rows match their governing specs where I checked them. A vocabulary Decision that mints no mechanism of its own is the correct instrument here.

**Concerns**

1. **MATERIAL, IN-DELTA — M-2 lists "Lane L row identity" as refuse-on-client-supply, contradicting LLP 0133's Lane L contract and C-7.** M-2 (`llp/0226-identity-architecture.decision.md:139–143`): "Where the server owns the mint (serial identity, settlement identity, Lane L row identity), a client- or handler-supplied value refuses with a stable `SNAPBACK_*` diagnostic," with an exception carved out **only** for Lane Q. But in Lane L, client-supplied speculative row ids are the *normal case*: `llp/0133-local-settlement.spec.md:191–199` says the server "re-derives every application-visible client-captured value by default" and "the locally captured values travel as claims and are recorded in the receipt; they are never authority" — recorded and rewritten via the published id map, never refused with a diagnostic. C-7 in this same document (lines 123–129) states the rederive-and-map behavior correctly, so the two normative rules conflict for the same values. Because the author demonstrably read "client-supplied" broadly enough to need the Lane Q carve-out (Lane Q's ids also arrive on the wire), an implementer or conformance reviewer applying M-2 literally would plausibly require refusing Lane L wires that carry claimed minted ids — a wrong guess that breaks the accepted Lane L design. Fix shape: one clause — either extend M-2's exception to cover Lane L's claims channel ("claims recorded and converted via C-7's id map are not supplied values; supplying a value *as authoritative* outside a declared conversion refuses"), or drop "Lane L row identity" from the refuse list and state that C-7 exclusively governs the speculative→authoritative crossing.

2. **implementation-phase, IN-DELTA — "(issuer, subject)" vs the substrate's physical `(provider, subject)` key.** The new Provider-identity row (line 54) and C-6 (line 120) key provider identity on "(issuer, subject)", but the shipped substrate keys `_auth_identities` on `(provider, subject)` (`llp/0057-auth-provider-protocol.spec.md:423–433`, unique index `_auth_identities_provider_subject_uq`), where `provider` names an installation, and non-OIDC providers (email-code) have no issuer at all. LLP 0151 itself reconciles this ("OIDC identity is canonically `(issuer, subject)`. A `provider_key` is …", `llp/0151-first-party-identity-integrations.rfc.md:370–377`), and the Decision's uniqueness scope ("one auth provider installation") already matches the physical key, so no decision is defective — but the auth-lane amendment will need the logical-vs-physical mapping stated. A parenthetical acknowledging the installation-keyed physical form would remove the only guess.

3. **implementation-phase, IN-DELTA — "ledger id" is an unattested term for Lane Q's accepted ids.** Lines 51, 125, and 311 call Lane Q's accepted client-minted ids "ledger ids". LLP 0133 never uses that term for them — the wire carries `{generatedIds, now}` under "the pin" (`llp/0133-local-settlement.spec.md:177–190`), and "ledger" in 0133/0129 consistently means the LLP 0129 decision ledger and claim ledgers. A corpus search finds "ledger id" nowhere else in this sense. In the document that enacts M-5 (vocabulary discipline), coining an unattested name for a namespace member is a self-inflicted discipline slip; the referent is recoverable from context, so this is editorial, not a defective decision. Fix: say "accepted client-minted ids (LLP 0133's `generatedIds` pin)".

4. **implementation-phase, PRE-EXISTING — settlement identity's "app" namespace component is actually caller-scoped.** The §1 row (line 57) gives uniqueness scope "App + instance + operation" and lane (c) (lines 266–268) glosses "namespaced to app (authFingerprint)". The verified implementation (`src/manifest.rs:9579–9594`, `auth_fingerprint`) hashes `(principal, session_id, user_id)` — it namespaces to the authenticated *caller*, not the app. The digest component list itself is quoted correctly from `llp/0043-offline-replay-retention.rfc.md:470–486` and C-4's rule is unaffected, so no wrong implementation follows; but a vocabulary Decision should not mislabel a namespace component. Fix: "caller/auth + instance + operation".

**Verifications performed**

- Read the full target document and its (c) delta enumeration; checked the Related header gains (0008/0011/0057/0058/0133/0158 all present and all files exist in `llp/`).
- LLP 0135: §1.1 counter tuple `(counterName, scopeTable, scopeRowId, scopeIncarnation)`, `_snapback_sequence_counters_v1`, "no authored start" pin, rejection-with-rationale, `(scopeId, relationIncarnation)` uniqueness-prefix rule; §1.5 exhaustion (in-transaction refusal, `SNAPBACK_SEQUENCE_EXHAUSTED`, whole-transaction rollback including the counter — confirming both M-4's shape and the delta's "un-burns values on rollback" reservation-timing question); §1.9 "any cross-scope or global counter" not lifted; §1.6 contention posture (supports the "expectation pending measurement" framing); OQ2 exists.
- LLP 0133: Lane Q `{generatedIds, now}` acceptance, Lane L rederivation-with-claims, `(mint site, occurrence)` id map, unmapped→cascade, private id-map carriers stripped on fan-out; "ledger" usage surveyed.
- LLP 0043: `ctx.mutation.settlement()` shape, digest components, replay stability, mutation-only refusal, hosted all-null twin — all as claimed.
- LLP 0007: 2026-08-08 identity-column-boundary amendment (lines 903–978) and the commit-version "exhaustion refuses before every mutation tier" precedent (revision log).
- LLP 0057/0151: `_auth_identities` DDL and indexes; `usr_`/`idn_` prefixes (LLP 0148:261); credential link/unlink/identifier-replacement lifecycle (0151:364–390).
- LLP 0191 §3 workarounds and sequence-semantics rationale; OQ5 envelope-early ruling (line 540); LLP 0129 IR-admission authority; LLP 0158 OQ9 (derived deployment).
- `issues/shelved/20260808-numeric-identity-default-columns.md` Author ruling — 2026-08-10: wholesale endorsement matches the schema lane point-for-point; all four Related tickets exist (one in `issues/closed/`); `issues/closed/20260808-guide-gap-mutation-settlement-identity.md` closed as stated.
- `guide/auth/app-identity-binding.md`: exists, matches C-2 (broker/frozen-actor-map, three unique indexes, bindMe-is-a-bypass).
- `src/manifest.rs` `auth_fingerprint` derivation (concern 4).
- Spot-checked `packages/snapback-client`/`snapback-codegen` sources for a conflicting `serial` on the validator surface: none found (only serialization hits), supporting the naming ruling.
- Did not read anything under `llp/reviews/`; modified no files. Not independently verified: the claimed absence of `serial` conflicts across the *entire* corpus (I checked the main package surfaces only), and LLP 0110's incarnation-registry details beyond what 0135 restates.

VERDICT: NOT READY

## Round 3 — 2026-08-10 (delta round; final budgeted round)

- Reviewer: claude family — fresh general-purpose subagent, model
  claude-fable-5.
- Capsule: detached worktree at commit `ceb7803c4` (0 target review
  artifacts present, verified).
- Target revision: (d), sha256 prefix `96f78dc9af17aeb8`.
- Instructions: sr-review-r3 delta template.
- Verdict: **READY** (0 MATERIAL; binds to the capsule/target hashes above).

### Verbatim review

**1. Summary**

Revision (d) of `llp/0226-identity-architecture.decision.md` is a tightening pass whose every substantive delta claim I could check verifies against the checkout: the settlement-digest correction (base preimage plus `operationIssuance` **and** `artifactGenerationDigest` for issuance-bearing operations, caller-scoped `authFingerprint`) matches the shipped implementation exactly (`src/storage.rs:975-1003`, `src/manifest.rs:9579-9593`); the rebuilt provider-identity row matches LLP 0151's physical `(provider_key, external_subject) → principal` model (`llp/0151:135,375,406`) and the email-code canonical-address subject (`llp/0057:311,486,505`); the M-2 rescope and C-7 exemption match LLP 0133's Lane Q `{generatedIds, now}` pin and Lane L claims-with-`(mint site, occurrence)` id map (`llp/0133:125,177-191,448-478`); the M-3 serial no-restart/no-prefix contract is a coherent decision correctly contrasted with LLP 0110/0135's intentionally restarting row-scoped counters (`llp/0135:225-280,516`); and the expanded schema-amendment question list correctly characterizes LLP 0135 §1.3's in-transaction counter advance (`llp/0135:349-365`). I found no MATERIAL defect; the remaining concerns are implementation-phase reconciliation and editorial items.

**2. Direction assessment**

The direction is right. The distributed structure — one Decision holding vocabulary and conformance, with implementation authority in three owner-amendment lanes — matches the recorded 2026-08-08 ruling (`issues/20260808-identity-architecture-decision.md`) and the 2026-08-10 wholesale endorsement of the schema lane's worked proposal, which I verified verbatim in `issues/shelved/20260808-numeric-identity-default-columns.md:109-117`. The namespace table is the document's core asset and each row now checks against its governing LLP or the code itself; notably, revision (d) made the settlement row *more* accurate than the owner LLP's own prose (see Concern 1). The conversion rules put the trust boundaries where the repository's real seams are (the guide's C-2 recipe at `guide/auth/app-identity-binding.md:40-71` — `bindMe` anti-pattern, broker/frozen-fixture, three unique indexes — is exactly what C-2 codifies), and §4's explicit fence-clearing against Accepted LLP 0135 §§1.1/1.9 and LLP 0007's 2026-08-08 identity-column-boundary amendment (`llp/0007:903-977`) is the honest way to authorize the serial column. An implementer following the mandatory question list in lane (a) is not forced into a wrong-plausible guess; the questions that remain genuinely open are named as open.

**3. Concerns**

1. **implementation-phase, IN-DELTA — the owner LLP's preimage enumeration now lags this Decision's corrected one.** §1's settlement row and lane (c) state the issuance-bearing preimage includes `artifactGenerationDigest` ("LLP 0163's complete selected-artifact binding"). That is correct against the code: `ClientMutationIdentity::activity_digest` widens the preimage with `"artifactGenerationDigest"` and `"operationIssuance"` exactly when issuance is present (`src/storage.rs:979-996`), and `llp/0163:669-672` states the complete-selected-artifact extension. But the named owner document's own text enumerates the digest as `{authFingerprint, authorityInstanceId, clientMutationId, function, inputFingerprint[, operationIssuance]}` with no `artifactGenerationDigest` (`llp/0043-offline-replay-retention.rfc.md:470-475`). An implementer reading the lane's owner doc inherits the omission. No decision here is defective — the Decision matches reality — but lane (c)'s scope list should name reconciling LLP 0043's stale enumeration (a one-line amendment task).

2. **implementation-phase, IN-DELTA — C-3's "appropriate generation" cites a carrier that today exists only for protected-relation scope parents.** C-3 and the row-identity mutability cell name "the row incarnation of LLP 0110," and "What this Decision does not decide" calls the incarnation clause "the interface, not a new mechanism." LLP 0110's incarnation substrate is the `_snapback_relation_incarnations_v1` registry keyed `(table_name, row_id, incarnation)` and minted for registered protected-relation parents (`llp/0110:221-223,1008-1013`) — an arbitrary table addressed through a mutable unique key has no incarnation carrier today, so the schema/0110/0129 amendments will in fact need either a substrate extension or a ruled fallback (e.g., `_id`-only binding with a stated residual). The delegation is explicit and the rule itself is sound, so this is a detail for the amendment, but the "not a new mechanism" phrasing slightly oversells what exists.

3. **implementation-phase, IN-DELTA — fork-sibling serial collision is implied but never stated.** M-3 scopes serial uniqueness to "one store lineage" with a high-water that "survives … fork," which entails two forked children both minting the same bare numeric for different rows thereafter. That is the correct PostgreSQL-sequence-like outcome and C-5/LLP 0158 OQ9 (`llp/0158:493`) already forbids cross-instance value comparison, but the amendment's high-water question (already in the mandatory list) should state the cross-sibling collision consequence explicitly so a permalink-issuing app is not surprised. No defective decision.

4. **implementation-phase, PRE-EXISTING — the "(§3b)" cross-reference is ambiguous.** The §1 clarification bullet routes claim exposure to "(§3b)", but §3 is "Conformance rules for the mints" and the auth lane is "(b)" under "The three owner-amendment lanes"; a reader searching §3 for a "b" subsection finds M-2. Untouched by the (d) diff (verified via `git diff 0eac1d309 ceb7803c4`). One-word fix: "lane (b)".

**4. Verifications performed**

- Read the full document and the exact (c)→(d) diff (`git diff 0eac1d309 ceb7803c4 -- llp/0226-…`), confirming the Status enumeration of revision (d) matches the actual delta line-for-line.
- Settlement identity: `src/storage.rs:800-1013` (`ClientMutationIdentity`, `activity_digest` versioned preimage `snapback:client-mutation-identity:v1`, issuance widening, `with_artifact_generation`), `src/manifest.rs:9579-9593` (`auth_fingerprint` over principal/session/user), `llp/0043:450-500` (handler surface, hosted all-null twin), `llp/0163:669-672`.
- LLP 0133: Lane Q/Lane L definitions, `{generatedIds, now}` pin, `(mint site, occurrence)` map, unmapped/cascade/private-carrier rules (`llp/0133:125,177-191,214,448-478,763`).
- LLP 0135: §1.1 counter identity tuple and `_snapback_sequence_counters_v1`, "no authored start" (`:225-281`), §1.3 same-transaction advance (`:349-378`), §1.5 `SNAPBACK_SEQUENCE_EXHAUSTED` rollback (`:432-444,991`), §1.9 not-lifted list (`:591-606`), `(scopeId, relationIncarnation)` prefix (`:259,516,879`), `AllocateSequence` (`:289`).
- LLP 0110 incarnation registry (`:221-223,336,1008-1013`); LLP 0007 2026-08-08 identity-column-boundary amendment, JS-safe integer profile, Index Contract (`:13,117,520,903-977`); LLP 0151 provider model and email-code (`:112,135,370-377,406`); LLP 0057 `canonical_address` (`:311,486,505`); LLP 0148 `usr_`/`idn_` prefixes (`:20,261`); LLP 0158 OQ9 (`:121,206,493`); LLP 0191 §3 workarounds (`:319-357`).
- Tickets and guide: `issues/shelved/20260808-numeric-identity-default-columns.md` (Author ruling — 2026-08-10, wholesale, `v.serial({ start })`), `issues/20260808-identity-architecture-decision.md`, `issues/shelved/20260808-guide-gap-principal-to-app-identity-binding.md`, `issues/closed/20260808-handler-settlement-identity-surface.md`, `issues/closed/20260808-guide-gap-mutation-settlement-identity.md` all exist; `guide/auth/app-identity-binding.md:40-71,165-188`.
- Naming: no `serial` on the validator surface (`packages/snapback-codegen/define.d.ts` has `principal()` but no serial member).
- Existence of all header-Related LLPs (0004, 0007, 0008, 0011, 0043, 0057, 0058, 0081, 0110, 0129, 0133, 0135, 0148, 0151, 0158, 0163, 0191).
- Not verified (stated per rules): whether every shipped insert/patch path today refuses handler-supplied `_id` with a stable code (M-2 is prescriptive; `SNAPBACK_DATA_PATCH_RESERVED`-class carriers exist at `src/data_patch.rs:523-524`, but I did not trace the insert path end-to-end).

**5. Verdict**

VERDICT: READY

## Round 6 — 2026-08-10 (delta round; final extension round)

- Reviewer: claude family — fresh general-purpose subagent, model
  claude-fable-5.
- Capsule: bare `git archive` export of commit `4f37cdd10` (sr-r6b).
- Target revision: (h), sha256 prefix `ea8056b79b1dffcd`.
- Verdict: **READY** (0 MATERIAL; binds to the capsule/target hashes above).

### Verbatim review

**Summary**

Revision (h) is a narrow, well-targeted delta: it states the restore-rewind consequence inside M-3 itself (serial = PostgreSQL sequence-in-backup, no stronger), rescopes §1's serial "never share" claim to within-lineage-at-every-instant, classifies booted `snapback store export` copies (LLP 0192) with fork as divergent sibling lineages, and moves the lifetime-sensitive qualifier next to the `_id`-only fallback prohibition. I verified the delta's new claims against LLP 0192 (the export verb boots directly and is a faithful byte-carrying copy, so it does continue the snapshot's high-water), and re-verified the load-bearing surrounding claims against LLP 0007/0110/0133/0135/0148/0151/0057/0158/0163, the cited tickets, the guide recipe, and the shipped settlement digest in `src/storage.rs`. Everything checked matches. The concerns I found are wording-precision and housekeeping items, none identifying a defective decision.

**Direction assessment**

The direction is right, and the (h) additions strengthen it in exactly the honest way this Decision has been evolving: instead of an unqualified "two visible rows can never share one" claim, the serial contract now names its true strength (within one lineage, at any instant, with the across-restore permalink re-mint consequence stated plainly and an escape route named). Classifying the LLP 0192 export copy with fork is correct — LLP 0192 D-2 (`llp/0192-store-durable-state-set.decision.md` lines 121–166) defines the export as a directory that "boots directly" and is a "faithful copy," so its database bytes necessarily carry the counter high-water, making "divergent sibling lineage continuing the snapshot's high-water" the only sound classification. The refusal of logical export/import for serial-bearing stores pending an LLP 0007 portable-carriage amendment is consistent with LLP 0007's own posture (its "Export and Engine Graduation" section, lines 760–774, names atomic logical import as a first-class open design problem). The overall namespace/conversion/mint structure remains sound and matched what I could verify in the repo.

**Concerns**

1. **implementation-phase, IN-DELTA — the two `_id`-only fallback boundary clauses draw slightly different boundaries.** In "What this Decision does not decide" (lines 376–379): "an `_id`-only fallback is prohibited for **lifetime-sensitive** durable or queued references … and is permitted only for explicitly non-lifetime-sensitive interactive operations." For a *non*-lifetime-sensitive durable/queued reference on an incarnation-lacking table, clause 1's qualifier implies it escapes the prohibition while clause 2's "permitted only … interactive" excludes it. A coherent reading exists (the passage is scoped "where lifetime matters," clause 2 is the complete rule, clause 1 emphasizes the worst case), and the passage explicitly delegates the boundary to the amendment "stated normatively" — so no decision is defective — but since (h) moved the qualifier here, one clause of tightening (e.g., drop "interactive" or restate the two-cell rule once) would remove the amendment author's only remaining guess in this passage.

2. **implementation-phase, IN-DELTA — export siblings share stream identity, so C-5's distinguishing mechanism is endpoint-only for them.** M-3 says the export copy is "never comparable to its source (C-5, LLP 0158 OQ9)," and C-5 says apps distinguish instances by "endpoint + stream identity." For fork, LLP 0158 actively mints a new stream identity ("new stream identity minted so cursors cannot cross," `llp/0158-instance-forking.rfc.md` line 495). LLP 0192's export, by contrast, is a faithful copy — "same sessions, same tokens, same admin authority" (line 140), with `resume-keyring.json` carried (line 98) — so a booted export sibling shares its source's stream identity and only the endpoint distinguishes them; nothing at substrate level prevents source-issued cursors/resume tokens from reaching the copy. The lineage classification decided here is correct and the non-comparability rule is app-conformance in both cases, but the mechanism asymmetry belongs to the LLP 0192/0158 owners; a parenthetical or a task pointer (as M-3 already does for the logical-import gap) would keep the reader from assuming fork's cursor-isolation property transfers to exports.

3. **implementation-phase, IN-DELTA — "immutable across restores" via identity-grade keys is retarget-proof, not dangling-proof.** M-3's new escape route ("Apps that need external references immutable **across restores** use an identity-grade source key or the row id," lines 186–188) is directionally right — random-bodied ids and identity-grade keys cannot silently re-mint for a different row the way a rewound serial certainly can — but a rewind can still erase the referent (dangling reference), and an app minting identity-grade keys deterministically could re-mint after a rewind since the restore erases the "never reused" evidence. Fine to leave to the guide/amendment; noting for precision.

4. **implementation-phase, IN-DELTA — LLP 0192 is now cited normatively but absent from Related.** Revision (h) makes M-3 depend on LLP 0192's export semantics, but the `**Related:**` header (lines 19–25) does not list LLP 0192. Metadata housekeeping per the corpus conventions.

No PRE-EXISTING MATERIAL concerns found: the previously reviewed claims I spot-verified all held (see below), including the ones the delta touches from context.

**Verifications performed**

- `llp/0192-store-durable-state-set.decision.md` D-2 (lines 121–166): export boots directly, faithful copy, WAL-consistent online backup, offline-under-lock; `Refuse` disposition for lineage-bearing members (lines 109–119); push-token custody D-3. Confirms the delta's "booted store export copy" premise and high-water carriage.
- `llp/0007-storage-portability.spec.md`: 2026-08-08 "closed string domains and the identity-column boundary" amendment (lines 903, 941–977, requiring gap semantics/exhaustion/0135-relationship — as §4 restates); JavaScript-safe integer profile (lines 117, 352); logical portable bundle / atomic import as open design (lines 760–774).
- `llp/0135-sequence-allocation-and-snapshot-batch.spec.md`: §1.1 protected framework table `_snapback_sequence_counters_v1`, "no authored start" (lines 225–280); §1.5 exhaustion — `SNAPBACK_SEQUENCE_EXHAUSTED`, in-transaction refusal rolling back source/scope/counter/commit/settlement (lines 432–449, also confirming the "un-burns on rollback" reservation-timing question is real); §1.9 cross-scope/global not lifted (lines 591–606); OQ2 = multiple allocations per invocation (lines 1376–1377).
- `src/storage.rs` lines 955–1004: settlement digest preimage exactly matches §1's row — base `{authFingerprint, authorityInstanceId, clientMutationId, function, inputFingerprint}`, issuance-bearing adds `artifactGenerationDigest` + `operationIssuance`. `llp/0043-offline-replay-retention.rfc.md` lines 464–486: `ctx.mutation.settlement()` surface; its enumeration (lines 473–474) indeed still omits `artifactGenerationDigest`, exactly as lane (c) states.
- `llp/0133-local-settlement.spec.md`: `{generatedIds, now}` pin (lines 125, 181), `(mint site, occurrence)` map with unmapped/cascade rules (lines 39–43, 448–476). `llp/0110-...spec.md`: host-minted incarnations in `_snapback_relation_incarnations_v1`, registered protected-relation parents only (lines 212–233) — supports the "today's registry" claim.
- `llp/0158-instance-forking.rfc.md`: OQ9 decided, same-`appId` derived deployment, new stream identity minted (lines 206, 493–495).
- `usr_`/`idn_` prefixes real (`llp/0057` lines 272, 1804; `llp/0148`); `(issuer, subject)` / per-provider subject / email-code model (`llp/0151` lines 366–406, 471–480).
- Naming ruling: repo-wide search for `serial` found only auth-keyring field names in hosted control payloads (`packages/snapback-cli/hosted-control.mjs:75`, `packages/snapback-hosted-supervisor/supervisor-response.mjs:44`) — nothing on the validator surface or schema grammar, so the "no conflicting use" claim holds.
- Referenced tickets exist, including the 2026-08-10 wholesale author ruling with `v.serial({ start })` in `issues/shelved/20260808-numeric-identity-default-columns.md` (lines 90, 109–117), and `guide/auth/app-identity-binding.md` exists.
- Not verified (no git history in this capsule): the (g)→(h) diff itself; I relied on the header/Status enumeration as the authoritative delta list per the review instructions.

**Verdict**

VERDICT: READY
