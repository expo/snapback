# LLP 0103 review — Fable family

## Round 1 — 2026-07-27

**Reviewer family:** Claude Fable  
**Provider / runtime:** Anthropic Claude Code 2.1.220,
`claude-fable-5`  
**Effort:** max  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh CLI runner, read-only tools, mutually blind structurally
isolated capsule  
**Target SHA-256:** `82e7c47985f2d3673297b227a59e1de9e701c6456c2f65c72247c96d2cb31d11`  
**Capsule SHA-256:** `77703203ed7f541c7d813626f8c4e400f5188a9c4c61dbcd2b10f97d61ffa5be`  
**Instruction SHA-256:** `c134524e6c55b71e4fa50dbacc4a35af311c1c8f97cc7f7d5f02fc81736c55eb`  
**Status:** unavailable — provider HTTP 429 before a review was delivered  
**Session ID:** `7ab7a020-5ffb-466d-af84-b29de5ca52f3`  
**Duration:** 1,106 ms  
**Failure:** the provider reported that the account reached its monthly spend
limit. This is not a review or verdict and does not count toward convergence.

### Remote retry — completed

**Provider / runtime:** Anthropic Claude Code 2.1.220,
`claude-fable-5` on the approved M4 Mac mini fleet lane  
**Session ID:** `9b208c88-5ba4-4cbb-bdc9-f946a03ee348`  
**Duration:** 1,009,765 ms  
**Cost:** $17.169486  
**Status:** completed

I have completed my review pass across the target spec, the governing corpus (LLP 0007, 0012, 0031, 0034, 0056, 0058, 0059, 0081, 0094), the guide, and the implementation (ensure/provision/reset paths in `src/local.rs`, `src/server.rs`, `src/storage.rs`, `src/storage/auth_invalidation.rs`, `src/storage/auth.rs`, the migration executor, codegen, CLI, Vite lifecycle, and the hosted `coordinator.js`). Here is the review.

---

# Review: LLP 0103 — Versioned seed evolution (super-refine round 1)

## 1. Overall assessment

This is a strong, unusually well-grounded spec. Nearly every mechanism it leans on is real and behaves as the spec claims: the closed `/app/ensure` intent family with `deny_unknown_fields` on both the legacy struct and every variant (`src/local.rs:920-951`), the domain-separated JCS digest house style (identical in shape to `MigrationPlanArtifactV1` in LLP 0081 §2, with RFC 8785 already proven in `schemas/content-digest.v1.json`), the `dataVersionStream` as a UUIDv7 in `_snapback_meta` rotated only by destructive reset (`src/storage.rs:810`) and declared restore (`src/storage/auth.rs:1375`) and retained across restart, mode transition, and LLP 0081 publication, the `privileged(seed)` writer class with `lastHolder` and the pinned DDL→seed→validation→indexes phase order (LLP 0056), and the exact legacy seed-if-empty vocabulary including gate-before-scan (`src/local.rs:4573-4600`). The non-destructive, insert-only, no-adopt posture is coherent and consistently enforced through the state machine, the migration binding, and the non-goals.

However, three material defects keep it short of READY: a self-contradictory sentence in §5.1 that, read literally, opens exactly the untracked-data adoption hole the spec exists to close; unspecified interaction between `install` and the staged auth-mode transition path that the ensure surface actually has; and an unstated client-preflight obligation for the new reset family, whose absence is destructive against the current hosted arm (whose reset handler never reads the body). All three are bounded, fixable-by-text defects, not architectural problems.

## 2. Strengths

- **Closed-protocol evolution is verified sound on the local arm.** `EnsureAppExplicitInput` is `tag = "intent"` + `deny_unknown_fields`, and the legacy object also denies unknown fields, so an `install` intent can never fall through to legacy provisioning on a new server and is refused outright by an old local server (`src/local.rs:943-951`). The reset body is likewise closed (`AppResetBody`, `src/server.rs:16011-16016`), so old local servers refuse new reset intents before any effect.
- **Honest treatment of the hosted open decoder.** §3.2 correctly identifies the LLP 0094 §0C.3 hazard (hosted `kitEnsureApp` ignores unknown members) and puts the defense where it must live: client capability preflight plus a hard never-downgrade rule with a client-minted `SNAPBACK_CLIENT_*` code, matching the LLP 0094 §0B.6 precedent. Incidentally, today's hosted `kitEnsureApp` also refuses any posted seed that isn't byte-equal to the compiled deployment seed (`SNAPBACK_UNTRUSTED_SEED`, `cloudflare/src/coordinator.js:4438-4444`), which is unclaimed defense-in-depth.
- **Stream scoping matches the implementation exactly.** Every consequence in §4.1 — restart retains, mode transition retains, reset rotates, restore re-scopes inside the sealed transaction, byte backup carries the record — is verifiable against real code paths; the declared-restore transaction is a genuine extension point for the identity rewrite (`src/storage/auth.rs:1340-1394`). LLP 0081 publication allocates a successor version within the same stream, so migration-advanced identity scoping is coherent.
- **The digest and receipt discipline follow the corpus's proven pattern**: domain prefix + one `0x0a` + JCS bytes, recompute-never-trust, golden vectors, and no approval-relevant fact outside the digest.
- **The legacy compatibility table (§5.3) matches the code line for line**, including the partial-population collapse to `skipped-nonempty` and gate-before-scan, and the requirement that legacy reset clears versioned identity is both implementable and backed by defense-in-depth (a surviving stale identity would fail stream-scope validation and classify corrupt rather than adopt).
- **Transaction ordering (§6.2) is grounded**: it matches LLP 0056's pinned phase order, the existing publish-only-after-commit function-generation seam (`src/local.rs:4369-4398`), the real authorization commit hook and witness (`seed.authorization.event`, `src/storage.rs:16648-16679`), and the existing commit-uncertain classification. Failure-injection seams the acceptance demands already exist (`src/storage.rs:102`, `restore_transaction_step_completed`).
- **The LLP 0081 binding is careful and abuse-resistant**: identity advances only at publication, is restored by generation republish, requires explicit reverse transitions, and pointedly refuses metadata-only adoption over untracked rows — with no generic escape hatch.
- **Acceptance (§12) is finite and target-honest**: arm-scoped ("where that arm claims the capability"), grounded in existing corpus homes (`tests/ensure_auth_v1.rs`, the schema drift gates, the package-cold-install precedent in `demos/competitive-checkpoint/`), and the advertisement gate in §14 prevents premature capability claims.

## 3. Concerns

**C1. §5.1's empty-arrays sentence contradicts its own classification table and, read literally, reopens the adoption hole. — Severity: Major, MATERIAL.**
Evidence: §1 defines a seed target as "every table key present in `tables`, including a table whose authored row array is empty," with occupancy defined over durable rows. The §5.1 table classifies absent-identity states by target occupancy. But the §5.1 prose says "An empty `tables` map **and a map whose arrays are all empty** classify as `uninstalled-empty` when identity is absent." For `{"seedVersion": "x", "tables": {"todos": []}}` against a populated `todos` table with no identity, the table says `untracked-nonempty` (refuse), while the prose says `uninstalled-empty` — under which §5.2 row 1 inserts nothing and **persists identity over untracked rows**. That converts untracked data into `installed` provenance, defeats `SNAPBACK_SEED_NONEMPTY_UNTRACKED` for those targets forever after, and hands §7.2's `evolve` a "valid installed predecessor" the installer never installed.
Resolution criteria: rewrite the sentence so only the zero-target case (empty `tables` map) is vacuously `uninstalled-empty`; an empty-array key remains a target whose occupancy is consulted and can classify `untracked-nonempty`/`untracked-partial`; add the populated-empty-array-target case to §12.2's refusal matrix.

**C2. The interaction between `install` and the staged auth-mode transition is unspecified. — Severity: Major, MATERIAL.**
Evidence: §3.1 imports LLP 0012's pair rules including "a first sessions deployment requires a complete v1-sessions schema/function pair," and LLP 0012 makes explicit `provision` the vehicle that *stages* sessions. The existing implementation applies schema, functions, **and seed at stage-commit time** when `requestedMode` differs from active (`stage_auth_mode_with_functions_classified`, `src/local.rs:4441-4462`), with activation following under LLP 0058's fence. §6's prepare/commit lists never mention desired-mode writes, staged commits, or activation; §8 covers only "sessions-mode same-mode provisioning." So it is undefined whether `install` (a) refuses when `requestedMode` ≠ active mode, or (b) may stage a transition — and if (b), whether identity/receipt are written at stage commit or at activation, and how that composes with the quiescence fence. The same silence covers `MODE_PENDING`, where LLP 0012 names privileged `provision` as the *sole* recovery branch.
Resolution criteria: state explicitly whether v1 `install` admits a cross-mode (staging) deployment; if yes, specify identity/receipt write timing relative to the staged durable commit and activation and reconcile with LLP 0058; if no, name the typed refusal and the supported path for moving a versioned-seed app from dev to sessions. State whether `install` is admitted or refused during `MODE_PENDING`.

**C3. The reset family's old-server failure mode and client preflight obligation are not specified — and the old hosted arm makes this destructive. — Severity: Major, MATERIAL.**
Evidence: the current hosted reset handler is admin-gated but **never reads the request body** (`this.reset()`, `cloudflare/src/coordinator.js:1460-1470`). A versioned client sending `{"intent": "resetInstall", "resetProtocol": …, "seed": …}` to a pre-0103 hosted target destroys the instance and silently drops the install half — a versioned destructive intent partially executed by a decoder that ignored the intent. The local arm is safe (closed `AppResetBody` refuses at parse, before `coordinated_app_reset`). §3.2's explicit preflight/never-downgrade/local-refusal rule covers only `install`; §3.3 says "capability-gated" without naming which capability fact gates the reset variants (`resetProtocol` is a distinct token, `snapback.reset.seed.v1`, and §3.2 registers only `supportedEnsureProtocols` with the ensure token), and §12.3 contains no acceptance item proving a versioned client refuses to send reset variants to a non-advertising target.
Resolution criteria: extend the client preflight + never-downgrade + fail-locally rule to `resetInstall`/`clear`, name the capability fact that gates them (either bundle under the `snapback.ensure.seed.v1` advertisement per §11, or register a reset-protocol fact), and add the corresponding negative acceptance item.

**C4. No HTTP status classes for the new diagnostic family. — Severity: Minor, DETAIL.**
Evidence: LLP 0012's status mapper is deliberately allow-listed ("an unrecognized diagnostic remains a 500"), and every comparable registration (LLP 0094 §0E, LLP 0012's item tables) assigns statuses. §9 assigns none, so at implementation time every refusal defaults to 500 or the mapping is invented ad hoc.
Resolution criteria: assign status/locus classes for the §9 codes (in §9 or the mandated LLP 0012 reconciliation) and require their allow-list registration.

**C5. `snapback ensure --json` is named as a consuming surface but does not exist. — Severity: Minor, DETAIL.**
Evidence: §10 lists "`snapback generate`, `snapback dev`, Vite lifecycle integration, and `snapback ensure --json` consume the same structured result." The JS CLI has `doctor`/`generate`/`dev` (plus dev verbs `status`/`reload`/`restart`); the Rust CLI has `start`/`load`/`reset`/etc. No `ensure` verb exists anywhere (`packages/snapback-cli/index.mjs`, `src/cli.rs`).
Resolution criteria: mark it as a new verb this spec introduces (and which CLI owns it), or remove it.

**C6. The codegen history check leans on the not-yet-existing review manifest. — Severity: Minor, DETAIL.**
Evidence: §2.2's `SNAPBACK_SEED_VERSION_REUSED` history check cites "the generated review manifest," which is an open P1 ticket (`issues/20260727-codegen-review-surface.md`), not a shipped mechanism. The "if a prior generated/review artifact is available" hedge and the definitive runtime check save correctness, but rollout step 3 ("land codegen emission and review-manifest history checks") reads as if the manifest exists.
Resolution criteria: name the committed prior `seed.artifact.json` as the v1 history mechanism (sufficient for the one-step check) and/or reference the ticket for the review-manifest form.

**C7. Guide reconciliation is absent. — Severity: Minor, DETAIL.**
Evidence: CI-verified guide pages teach legacy seed semantics as the paved path — `guide/getting-started/your-first-backend.md` ("Seed deterministically"), `guide/clients/headless.md:158-170`, `guide/clients/contract-adapter.md:177-178`, `guide/testing/acceptance.md` (seed-true reset), and the `backend.seed` capability row in `guide/capabilities.md:41`. §11 step 6 changes the managed dev-loop default, yet neither §11, §12, nor §14 names guide/capability-index updates, contrary to LLP 0061 practice.
Resolution criteria: add guide-page and capability-index reconciliation (or an explicit GAP row) to the rollout/acceptance sequence.

**C8. §14's amendment list omits LLP 0059 (and the restore protocol's owner). — Severity: Minor, DETAIL.**
Evidence: §6.3 adds identity/receipt writes to the LLP 0059-governed coordinated-reset transaction, §5.3 adds identity clearing to the legacy reset transaction, and §4.1/§12.3 add the identity re-scope to the sealed declared-restore transaction (LLP 0057/0059 territory). §14 names only LLP 0012, 0094, 0034, and 0081.
Resolution criteria: name the LLP 0059 (and restore-side) dated amendments in §14, or state why the reset/restore owners need no amendment.

**C9. `SNAPBACK_SEED_IDENTITY_CORRUPT` remediation is ambiguously scoped. — Severity: Minor, DETAIL.**
Evidence: §9's remediation, "stop serving effects and recover from a verified backup or operator repair," can be read as poisoning the whole instance for a corrupt metadata record whose only consumer is the seed protocol; §5.2 only says installs refuse.
Resolution criteria: state explicitly whether a corrupt seed identity blocks only versioned seed/migration/reset operations or the app instance generally.

**C10. `seedTransition` optionality and its plan-digest consequence are unstated. — Severity: Minor, DETAIL.**
Evidence: §7.2 says a migration "that changes seed identity includes" the member, and defines an `unchanged` variant — but not whether the member is required on every plan (which would change every future plan digest and the canonical body) or optional-with-absent-means-`unchanged` (which preserves pre-0103 plan shapes and approvals).
Resolution criteria: the LLP 0081 amendment must state the member's optionality, the meaning of absence, and the effect on existing approved plans.

**C11. Two misleading prose spots in otherwise-precise sections. — Severity: Trivial, DETAIL.**
Evidence: (a) §3.3's rationale for forbidding metadata-only clear — "that would manufacture untracked data **and** make a later install look eligible" — conflates two mutually exclusive outcomes (nonempty targets → untracked refusal; emptied targets → eligibility); both are real hazards but under different occupancy. (b) §5.2's remedy 3 for untracked data ("author and approve a migration when the desired evolution is representable under §7") is, per §7.2, never satisfiable in v1 for establishing identity over untracked data.
Resolution criteria: split (a) into its two cases; qualify (b) so it does not read as a v1 adoption path.

## 4. Suggestions

- State the relationship between the new `SNAPBACK_SEED_DECLARATION_INVALID` and the existing emitted, allow-listed `SNAPBACK_SEED_INVALID` (`src/server.rs:20561`, `:33389`), which presumably remains the legacy path's code — changing an emitted code is a compatibility event under LLP 0012.
- Record the current hosted `SNAPBACK_UNTRUSTED_SEED` byte-equality refusal in §11's intermediate-point matrix as observed (incidental) defense-in-depth for stray `install` bodies against the pre-0103 hosted arm.
- Either add a dry-run acceptance item to §12 or mark §10's dry-run paragraph as optional/deferred; today §10 specifies it in normative detail while §12 never proves it.
- Consider aligning the metadata key spellings with the format-version spellings (`snapback.seed.identity.v1` key vs. `snapback.seed-identity.v1` format; `snapback.seed.last-receipt.v1` vs. `snapback.seed-receipt.v1`) — the near-miss pairs invite transposition bugs.
- Add the instance-local limit of runtime version-reuse detection (two different instances can durably hold the same `(appId, seedVersion)` at different digests, detectable only when their artifacts meet) to §13's non-goals; §2.2 implies it but stating it closes the question.

## 5. Open questions

1. Is `install` admitted during `MODE_PENDING`, given LLP 0012 names privileged `provision` as the *sole* schema-apply recovery branch? (Folds into C2.)
2. `resetInstall` carries no schema/function halves — is the new seed validated against the retained loaded schema generation, and is the supported flow for "changed seed + changed schema" therefore `clear` followed by `install`? The spec should say so.
3. Is exposing seed `state` (`absent | installed | corrupt`) through *public* inspection a deliberate disclosure decision, or should public callers see protocol support only?
4. Numbering: the capsule contains 0000–0100 and 0103, with 0101/0102 absent — reserved elsewhere, or a numbering skip against the next-available-number convention?

## 6. Readiness verdict

The spec's architecture, safety posture, wire-compatibility analysis, and grounding are excellent, and most of the corpus alignment is already exact. But it cannot pass review with a literal-reading adoption hole inside its own classification section (C1), an undefined interaction with the staged mode-transition path the ensure surface actually has (C2), and an unstated destructive-path preflight obligation whose absence is demonstrably harmful against the deployed hosted arm (C3). All three are text-level fixes well within one refine round.

VERDICT: NOT READY

## Round 2 — 2026-07-27

**Reviewer family:** Claude Fable  
**Provider / runtime:** Anthropic Claude Code 2.1.220,
`claude-fable-5` on the approved M4 Mac mini fleet lane  
**Effort:** max  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh remote CLI runner, read-only tools, mutually blind
structurally isolated capsule; delta-round instructions  
**Target SHA-256:** `26066df9c4af0f2b92c18a355a0b2e3f22919fbf91ca83eb107448f5757851f1`  
**Capsule SHA-256:** `4042773db57c2cad47a7e1e48b4c2a1dd65aae7b7a93130a27100a692678f9b3`  
**Instruction SHA-256:** `20a368c9069f3d9c41ac906e58bb6133f87cca2cf3533e5df2690451da79408e`  
**Status:** completed  
**Session ID:** `25bb0f68-cd67-43a1-8f3c-a6fbe992fa5e`  
**Duration:** 1,203,149 ms  
**Cost:** $25.151799

The fourth agent has reported. All load-bearing claims are now verified against the implementation. I have what I need to write the Round 2 review.

---

# LLP 0103 super-refine — Round 2 review

## 1. Overall assessment

This revision is a substantial, mostly successful closure of the Round 1 surface. I verified its load-bearing compatibility and implementability claims directly against the tree, and the important ones hold: the pre-bind startup carrier really is a closed decoder, so a predecessor genuinely rejects a V2 carrier rather than half-consuming it; the durable app-data stream identity (`dataVersionStream`) really exists, is rotated exactly where §4.1 requires (reset and declared restore), and is already consumed by RQS tokens and the migration audience; the host-ops `app.reset` carrier really is an open decoder that would discard a versioned body and reset anyway, which validates §3.3's predecessor-unknown-carrier design as the correct fix rather than an abundance of caution. The no-adoption stance is airtight, every refusal path I traced is non-destructive, and the migration/restore machinery the spec composes with is implemented, not aspirational.

Four material problems remain, all bounded: the new destructive reset routes are placed in the root namespace in conflict with LLP 0031's settled reserved-prefix proxy invariant; §8's sessions-mode membership-seed ordering is unimplementable as written because catalog creation and activation are a single consume-time step today; §8 cites a "stricter destructive reset authority" that has no referent (reset and provisioning share the identical gate); and the §12 acceptance matrix names a host-op ensure carrier that does not exist. None requires a structural rethink — each resolves with a targeted respecification plus the matching amendment-scope entry in §14.

## 2. Strengths

- **Predecessor-rejection claim is true in code.** `StartupArtifacts` is `deny_unknown_fields` with a strict `formatVersion` check (`src/auth/mode.rs:329-353`), so §3.1.1's claim that a V1-only binary rejects the V2 carrier before misreading `.tables` is verified, not asserted.
- **The predecessor-unknown reset design addresses a real, demonstrated hazard.** `HostOpsRequest` is an open struct (`src/host_ops.rs:356-378`): a versioned clear body sent through legacy `app.reset` would decode with the versioned fields silently dropped and execute an empty destructive reset. New operation names an old binary cannot dispatch (`SNAPBACK_HOST_OP_UNKNOWN` after the AdminWrite gate) plus mandatory preflight is exactly the right shape. The local HTTP legacy route is additionally already closed (`AppResetBody` `deny_unknown_fields`, `src/server.rs:16012`).
- **The identity scope has a real referent.** `auth_invalidation_data_version_stream_v1` in `_snapback_meta` (`src/storage/auth_invalidation.rs:17,493-522`) is rotated only in reset (`src/storage.rs:810`) and declared restore (`src/storage/auth.rs:1375`) — precisely the §4.1 consequence list — and the declared-restore transaction is a workable home for the same-transaction restore re-scope and receipt.
- **No-adoption is airtight.** No transition mints identity from occupancy; legacy lanes cannot create, preserve, or advance identity; §7.2 admits `evolve` only from a valid installed predecessor; the empty-array-over-populated-table case is pinned in both §5.1 and the acceptance corpus.
- **§5.3 describes shipped behavior exactly**: gate-before-scan (`src/local.rs:4575-4581`), whole-declaration skip (`src/local.rs:4583-4595`), and the staged lane's fresh-target guard (`src/storage/auth_mode.rs:1594-1625`).
- **§9's precedence order mirrors the implemented pipeline** — indeterminate effect-bearing bodies already authenticate at the strongest branch before typed decode (`src/server.rs:10321-10329`).
- **Digest house style is consistent with the migration family** (`snapback:…:v1` + `\n` + JCS, `src/migration.rs:30-37`), and RFC 8785 exists on both arms with a parity gate (`src/rqs.rs:277`, `packages/snapback-client/rqs.mjs:180`, `tests/rqs_digest_parity_v0.rs`).
- **The acceptance matrix has real precedents** to inherit: the data-tier corpus manifest with pinned cases, the wire-fixtures arm×lane tuple routing, the structural-validation corpus that already carries seed cases, and a shipping package-cold-install lane that already copies `seed.json`.
- **Receipt discipline matches the shipped version-advance discipline** — `matched` performs no durable write, and empty-seed installs not inventing a data version aligns with the `if !changes.is_empty()` pattern at every existing `set_version` site (`src/storage.rs:2234-2236`).

## 3. Concerns

**C1 — Sessions-mode membership-seed ordering is unimplementable as written.** Severity: high. **MATERIAL.**
Evidence: §8 states "Provider/principal catalog bootstrap therefore precedes membership seed validation, while catalog activation still follows LLP 0058's stage/consume fence." In the implementation, the stage transaction runs seed and `validate_membership_activation` (`src/storage/auth_mode.rs:581,597`), but the catalog tables (`_auth_users`) are created only inside consume (`activate_current_auth_catalog_in`, `src/storage/auth_mode.rs:775`); sessions manifests force `require_catalog_principal` (`src/storage.rs:7499`), and `principal_is_eligible_on` returns ineligible whenever `_auth_users` is absent (`src/storage/auth_agents.rs:241-260`). So every `lastHolder`-protected membership seed refuses `SNAPBACK_MEMBERSHIP_ACTIVATION_UNPROTECTED_RESOURCE` at stage; there is no "bootstrapped but unactivated" catalog state for the spec's ordering to run in. §12.4 names "catalog-principal ordering" as an acceptance case, but the mechanism that would make it pass is unspecified, and §14's LLP 0058 amendment scope ("StartupArtifactsV2 stage/consume") does not name this reordering.
Resolution criteria: either specify the bootstrap/activation split as explicit new work (which transaction creates catalog rows before stage-time validation, under what authority, and how consume revalidates) and add it to the LLP 0058/0057 amendment scope, or narrow v1 with a typed refusal for sessions-mode membership seed until that step exists — with the §12.4 case updated to match.

**C2 — New destructive routes at root conflict with LLP 0031's settled namespace invariant.** Severity: medium-high. **MATERIAL.**
Evidence: §3.3 names `/app/reset-install-v1` and `/app/reset-clear-v1` as direct routes. LLP 0031's settled payoff is that a proxy grants the app surface with one rule — "forward the root, refuse `/_snapback/*`" (0031:35-36) — and destructive reset was deliberately retired from the root to the gated `/_snapback/api/app/reset` (0031:130-132; `src/server.rs:7358-7364`). Placing brand-new destructive carriers in the forwardable root namespace reverses that defense-in-depth without acknowledgment, and §14 names LLP 0031 only for "gated decode/redaction," omitting the mandatory route-registry/matrix amendment for new routes and host-ops.
Resolution criteria: move the carriers under `/_snapback/api/` (or record an explicit, argued exception in an LLP 0031 dated amendment), and name the 0031 route-matrix amendment in §14 with full policy axes for the two routes and two host-ops.

**C3 — "Stricter destructive reset authority" has no referent.** Severity: medium. **MATERIAL.**
Evidence: §8 says `resetInstall`/`clear` use "the stricter destructive reset authority and profile gate from LLP 0031/LLP 0059." Today provisioning and destructive reset share the identical gate: `"app.reset" | "app.ensure.provision" | … => OperationProfileRequirement::NonProd` (`src/admin.rs:213-216`), both `RoutePolicy::AdminWrite` (`src/server.rs:13192-13204,13323-13328`); LLP 0031's matrix lists them identically, and LLP 0059 contributes the premark/finalize protocol, not a stronger authority. An implementer directed to the "stricter" gate finds nothing.
Resolution criteria: pin the exact gate — either "the same AdminWrite + non-prod gate that governs `app.reset`" or a newly defined stricter carrier (which then needs its own 0031 registry treatment and a §14 entry) — and make §12.4 test the pinned gate.

**C4 — The acceptance matrix names a nonexistent host-op ensure surface.** Severity: low-medium. **MATERIAL.**
Evidence: §12's row "host ops `app.ensure` + new v1 reset ops | required | required" and §10's "the existing host-op JSON carrier" — but `SERVED_HOST_OPS` is exactly eight operations with no ensure (`src/host_ops.rs:32-41`); ensure is HTTP-only (`src/server.rs:16833`). Meanwhile the two real packaged dev-loop carriers go unnamed: the Vite lifecycle provisions via host-ops `schema.load`/`functions.load`/`app.reset` (`packages/snapback-vite/lifecycle.mjs:301-334`) and the packaged CLI shells `snapback load`/`snapback reset --seed` (`packages/snapback-cli/index.mjs:1190-1207`). Since §11 step 6 makes versioned install the managed dev-loop default, the row a capability advertisement depends on must name surfaces that exist.
Resolution criteria: either specify the new closed host-op install carrier as new work (name, closed schema, gate) or correct the row to the real carriers, and state which carrier each dev-loop path uses for versioned install.

**C5 — §7.2 mischaracterizes LLP 0081's planDigest as "length-framed."** Severity: low. **DETAIL.**
Evidence: planDigest is SHA-256 over domain prefix + one `\n` + JCS body bytes, emitted as bare hex (0081:175-180; `src/migration.rs:520-540`). The only length-framed digest convention in the tree is codegen's `sha256Framed` (`packages/snapback-codegen/index.mjs:5603-5615`). A follower of 0103's wording would construct the wrong preimage.
Resolution criteria: say "domain-separated JCS planDigest," and note migration digests are bare hex while seed digests carry the `sha256:` prefix so the v2 amendment doesn't accidentally unify them.

**C6 — Unpinned digest preimages and operation-id provenance.** Severity: low-medium. **DETAIL.**
Evidence: §3.3's `requestDigest` names no domain string, unlike every other digest in the spec and house style; §7.2's `predecessorTablesDigest`/`successorTablesDigest` computation is never defined (and DML-vs-no-DML admission keys on their equality); §4.2's receipt requires `operationId` and `requestOrPlanDigest` for install and restore-rebase, but the closed §3.1 install request carries no `operationId` and the canonical-request preimage for an ensure body is unspecified.
Resolution criteria: pin the reset-request domain string; define the tables-digest preimage (or drop the members and let executors recompute from the bound artifacts); state who mints install/restore `operationId` and what `requestOrPlanDigest` binds on those paths — all of it feeds §12.1's golden vectors.

**C7 — §9's HTTP registration diverges from the shipped status dialect.** Severity: low-medium. **DETAIL.**
Evidence: nothing uses 426 today; the drift gates require every emitted code to sit in a reviewed status family (`src/server.rs:33863,33926`; families at `src/server.rs:33784-33803`), and the closest existing condition, `SNAPBACK_MIGRATION_UPGRADE_REQUIRED`, maps to 409 (`src/server.rs:20148-20150`). Separately, `SNAPBACK_SEED_MODE_PENDING` → 409 diverges from `SNAPBACK_AUTH_MODE_PENDING` → 503 (`src/server.rs:20278`) for the same underlying pending-transition condition.
Resolution criteria: align with precedent (409 for receiver-known unsupported protocol, 503 for mode-pending) or explicitly justify both divergences and note that the 426 family must be added to the reviewed-family inventory in the same landing.

**C8 — Absent-identity restore versus the "exhaustive" protected-pair list.** Severity: low. **DETAIL.**
Evidence: §4.2 says "Restore rebase and rollback-republish **always** write a new receipt whose successor equals the active identity," but the exhaustive valid-pair list has no absent-identity + restored pair. Restoring a backup of a cleared or never-versioned stream has no identity to rebase; a literal reading of "always" produces a null-successor restored receipt → a pair outside the list → spurious `corrupt` → §9 then blocks versioned install/reset on a legitimately restored target.
Resolution criteria: state that restore writes a seed receipt only when a backed-up identity exists (the carried cleared/no receipt is retained otherwise), or add the missing pair; add a §12.3 case restoring a cleared backup.

**C9 — The 1,024 ceiling caps seeds structurally, and today's bound is conditional.** Severity: low-medium. **DETAIL.**
Evidence: §6.2 step 7 mandates the aggregate 1,024 direct-plus-derived ceiling on install. Today that bound exists only inside projection maintenance (`src/storage.rs:5591-5597`, a bare literal, reached only when projections exist at `src/storage.rs:3066,3592`), while `seed_into_transaction` is unbounded (`src/storage.rs:9731-9778`). Making it unconditional caps versioned seeds at ≤1,024 writes with no batching escape (§5.2 forbids table-by-table retries) — a functional limit adopted silently, and rollout step 6 moves every demo onto it (all-aboard's generated seed is the plausible risk).
Resolution criteria: state the cap and its refusal code explicitly (presumably §2.3's portable-limits row), confirm existing demo seeds fit or define the sanctioned remediation, and name the constant.

**C10 — Corpus-exactness and naming drift.** Severity: low. **DETAIL.**
Evidence: "recoverable effective principal" — settled term is "durably recoverable" (LLP 0055; `src/storage/auth_agents.rs:632`); "AdminSecretRead/developer twin" — settled term is "gated twin" (0031:134ff); the identity key's dotted style (`snapback.seed.identity.v1`) diverges from `_snapback_meta`'s snake_case convention (`auth_mode_state_v1`, `auth_stream_incarnation_v1`); "StartupArtifactsV1" is a retroactive name for the shipped `StartupArtifacts` (numeric `formatVersion`, no committed schema); the manifest member carrying `snapback.reset.seed.v1` is unnamed (`supportedEnsureProtocols` is specified only for ensure), and `TargetCapabilityId` is a closed enum with an already-skewed hosted mirror (`src/manifest.rs:3783-3821` vs `cloudflare/src/coordinator.js:120-130`); the shipping `SNAPBACK_SEED_INVALID` (pinned by `tests/conformance/structural-validation.corpus.json:216-240`) is unmentioned beside the new `SNAPBACK_SEED_DECLARATION_INVALID`.
Resolution criteria: one editorial pass adopting settled vocabulary, pinning the capability's carrying member, and stating that `SNAPBACK_SEED_INVALID` remains the legacy row-level code.

## 4. Suggestions

- Name `issues/20260727-codegen-review-surface.md` explicitly in §2.2 and settle `seed.artifact.json`'s custody class jointly with that ticket — its committed-manifest/committed-projection/ignored-cache split directly governs whether the "committed prior artifact" one-step history premise stays true.
- Specify that codegen's seed digest uses the shared RFC 8785 implementation (`src/rqs.rs` / `packages/snapback-client/rqs.mjs`) rather than codegen's `stableJson`/`sha256Framed` conventions; §12.1's golden vectors then double as the cross-package parity gate.
- Cheap mistake-proofing: `SeedData` is an open decoder (`src/manifest.rs:3732-3736`), so a `SeedArtifactV1` file passed to legacy `snapback reset --seed` or a host-ops seed member would seed its `tables` while silently stripping the identity members. Have new tooling refuse artifact-shaped files on legacy seed flags.
- §5.3 normalizes three distinct legacy seed lanes (ensure's scan-based check, same-mode network's COUNT-based check, the staged lane's fresh-target guard); listing them would help the acceptance corpus cover all three rather than the first.
- Consider a stated retention/GC bound for the reset journal, since `operationId` is never-reused and the journal otherwise grows forever.

## 5. Open questions

1. **Corrupt-state exit.** Versioned `clear` refuses on `corrupt` (§9), yet the retained legacy empty reset — which §5.3 says clears identity with data — remains reachable under the very same AdminWrite + non-prod gate. Is legacy reset the intended in-protocol destructive exit from corruption, or should versioned `clear` admit corrupt targets under explicit authority? Relatedly, which side's corruption blocks "restore re-scope" — the active target's records or the backup payload's?
2. Is `supportedEnsureProtocols` intentionally a new manifest member, given `supportedCapabilities` already carries protocol-shaped ids like `auth.sessions.v1`?
3. LLP numbering: 0101 and 0102 exist neither in `llp/` nor `llp/tombstones/` — reserved elsewhere, or should this document take the next available number?
4. Does any existing demo seed (notably all-aboard's generated seed) exceed the 1,024-write ceiling that §6.2 would impose at rollout step 6?

## 6. Readiness verdict

The revision genuinely closes the claimed Round 1 findings — occupancy, stage/consume composition, predecessor-unknown reset, receipts, restore/rollback lineage, no-adoption, and the finite matrix are all present, internally coherent, and (with the exceptions above) implementable in this repository, and every destructive or identity-establishing transition I traced is non-destructive on refusal. But C1 prescribes an ordering the implementation cannot satisfy and no amendment scope covers; C2 contradicts a settled, enforced namespace decision on a destructive surface; C3 anchors destructive authorization to a gate that does not exist; and C4 gates capability advertisement on a surface that does not exist. Those four must be resolved (each has a narrow fix) before this Spec can move past Review.

VERDICT: NOT READY

## Round 3 — 2026-07-27

**Reviewer family:** Claude Fable  
**Provider / runtime:** Anthropic Claude Code 2.1.220,
`claude-fable-5` on the approved M4 Mac mini fleet lane  
**Effort:** max  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh remote CLI runner, read-only tools, mutually blind
structurally isolated capsule; final delta-round instructions  
**Target SHA-256:** `3677ae4f5f988a21d96099e44bb041f8bf332d4ef2713d96f9ec61b491a70174`  
**Capsule SHA-256:** `e122d7cc8a53c4581e66f2e442047718d69e6be49981cf631dad4990a036721b`  
**Instruction SHA-256:** `76c6b4fbf39b58487c1ac20655a4cd97a628b7731c8e2b55aaa9100948001dd5`  
**Status:** completed
**Session ID:** `a4caf956-ed83-49fe-a70a-ad1e95b8ac1d`
**Duration:** 1,056,263 ms
**Cost:** $19.11155225

The motivating ticket (`issues/20260727-versioned-seed-identity.md`) asks for exactly what the spec delivers — including stream-scoped durable identity. All verification threads are complete. Here is the review.

---

# Review: LLP 0103 — Versioned seed evolution (super-refine round 3)

## 1. Overall assessment

The round-2 narrowing worked. Every load-bearing claim §15 makes about the existing implementation checks out against the code in this capsule, and the one design move the round targeted — keying active identity by the existing data-version stream — is verified sound against the actual reset, restore, and metadata machinery, not just plausible on paper. The first landing (`install`/`matched`, single-transaction `resetInstall`/`clear`, effect-free preview, stream-keyed `_snapback_seed_installations_v1`, operation-id replay journal) is implementable in this repository with no invented mechanisms: the reset transaction it composes into exists as one IMMEDIATE SQLite transaction, the 1,024 ceiling it names is the existing mutation bound, the JCS/domain-digest style it specifies is the shipped migration-digest style, and the gates it names are the gates the code enforces.

The residual weakness is structural, not substantive: §15 supersedes so much of §§3–12 (transport, carriers, receipt shape, status codes, conformance matrix) that the document now contains two partially contradictory specifications, with the supersession resolved only by a blanket rule. That is acceptable for this round by the document's own framing, but several specific residues are subtle enough to mislead an implementer, and two executability details in §15.5 need one sentence each. None of these is a soundness hole.

## 2. Strengths

- **The stream-keyed identity fence is real, verified end-to-end.** `auth_invalidation_data_version_stream_v1` is a canonical UUIDv7 in `_snapback_meta` (`src/storage/auth_invalidation.rs:17,493-522`). Every shipped destructive path rotates it inside its one transaction: legacy reset at `src/storage.rs:810` (inside `reset_and_seed_transaction`, reached by the route `/_snapback/api/app/reset`, host op `app.reset`, CLI `reset --seed`, and client `reset()`/`seed()` — all funneling through `attempt_reset_with_seed_and_authorization_stream`), and restore at `src/storage/auth.rs:1375` (inside `apply_auth_restore_declaration`). Meanwhile `physical_user_tables` excludes `_snapback*` tables (`src/storage.rs:8478`) and reset deletes only enumerated meta keys, so an unmodified predecessor's reset leaves the new installations table untouched while rotating the key that makes its rows reachable. Stale identity rotates *away*, exactly as claimed. Notably, the earlier §4.1 meta-key layout would have wedged on this exact scenario; §15.1 is a genuine fix, not a restatement.
- **"Single SQLite reset transaction, recovery has only not-committed and committed" is accurate.** The existing reset is one immediate transaction with durable-successor commit-certainty reconciliation (`src/storage.rs:2035-2128`); adding seed rows, identity, and the operation receipt to it eliminates the round-2 publication journal honestly rather than by decree.
- **Gates and routes are named truthfully.** `app.reset` and `app.ensure.provision` are both `AdminWrite` + `NonProd` (`src/admin.rs:192-227`); §15.3's "no nonexistent stricter gate" corrects §8's earlier claim and matches LLP 0031:334/338. `/_snapback/api/` is the admin-model-gated subset of the reserved namespace — the right home for these operations.
- **Predecessor-unknown operation names hold.** `SERVED_HOST_OPS` (`src/host_ops.rs:32-41`) has no `app.ensure` and no seed ops; unknown ops refuse with `SNAPBACK_HOST_OP_UNKNOWN` and no effect; unknown routes 404. §15.3's "no claim that a legacy `app.ensure` host operation exists" is correct, and the `app.seed.*` naming follows LLP 0031:643-645's own directive.
- **§5.3's legacy characterization matches the implementation exactly** — outcome strings `seeded|skipped-nonempty|gated|skipped-absent` (`src/local.rs:4573-4600`, `schemas/app.ensure.output.schema.json:81-84`), all-or-nothing occupancy with first-nonempty short-circuit, gated-before-scan ordering, and no durable identity anywhere today (repo-wide grep confirms `seedVersion` exists only in this spec and its ticket).
- **The quantitative ceiling is the existing number.** `direct_writes + projection_writes > 1024` is already enforced with rollback (`src/storage.rs:5592`, `SNAPBACK_PROJECTION_FANOUT_EXCEEDED`), matching LLP 0080:430-435 and LLP 0007:330. Naming it `VERSIONED_SEED_MAX_EFFECTS_V1` adds a constant where the code currently has bare literals.
- **Digest and identity machinery have direct precedent.** In-repo RFC 8785 JCS with Rust/JS parity tests (`src/rqs.rs:117-281`, `packages/snapback-client/rqs.mjs`), prefix+`\n`+JCS domain digests (`src/migration.rs:520-536`), golden-vector file precedent (`schemas/content-digest.v1.json`), caller-minted canonical UUIDv7 with validation (`src/auth/lifecycle.rs:159,254-259`). §15.4's carriers are buildable with existing parts.
- **Refusals are non-destructive throughout.** Every §5.2 refusal row has no durable transition; the prepare-before-effect ordering matches the corpus's authorize-before-effect doctrine and the existing gated-before-scan precedent; reset refusals (stream mismatch, id reuse, invalid artifact) precede the destructive transaction, and §15.1's strict non-creating stream reader for preview correctly anticipates that the existing `ensure_data_version_stream_in` read is creating.
- **Membership handling is honest.** `MembershipWriter::Seed` and the `privileged(seed)` carrier already exist (`src/storage.rs:9972`, LLP 0056:1444-1465, 1383-1388); the sessions membership-bootstrap refusal avoids the `lastHolder` chicken-and-egg rather than hand-waving it.
- The mode-pending 503, `SNAPBACK_SEED_INVALID`, allow-listed status mapper, capabilities-page dated-GAP enforcement (`scripts/guide-lib.mjs:372-391`), conformance-manifest drift enforcement precedent (`tests/data_tier_corpus_v0.rs`), and package-cold-install script all exist as the spec assumes.

## 3. Concerns

**C1. The acceptance gate references two divergent conformance matrices.** Severity: moderate. **MATERIAL.**
Evidence: §14 forbids advertisement "until its complete §12 matrix passes," while §15.5 commits `tests/conformance/versioned-seed-v1.manifest.json` with a different, closed runner set. §12's matrix contains rows §15 makes false or moot: "host ops `app.ensure`" (no such op exists), two `StartupArtifactsV2` rows, and a "hosted compiled-seed arm — required or GAP" row that §15.5's closed runner set (HTTP, CLI, four host ops, Vite, cold-install, restore/migration refusal) cannot even express as a machine-readable GAP.
Resolution criteria: one authoritative matrix. Either rewrite §12's table to the §15 operation set (marking removed rows) or state in §15.5 that its manifest replaces §12's matrix as the advertisement gate, and give the hosted arm an expressible disposition (a GAP row in the manifest, or an explicit out-of-manifest nonclaim).

**C2. The v1 disposition of the sessions startup carrier is only resolvable by inference.** Severity: moderate. **MATERIAL.**
Evidence: settled sessions mode requires `--startup-artifacts` on *every* start (`src/cli.rs:178`), and that carrier's `seed` member is the open legacy `SeedData` (`src/auth/mode.rs:328-336`; nested `SeedData` at `src/manifest.rs:3733` has no `deny_unknown_fields`, so a versioned source passed there would silently drop `seedVersion`). §3.1.1 specifies `StartupArtifactsV2` for exactly this, but §15 neither admits it (no carrier in §15.4, no runner in §15.5) nor lists it among the removals in §15.2. A reader must derive "out of v1, pass no seed in the carrier, install post-activation via the four operations" from §15.2's "admits exactly" plus §15.3's never-fall-back sentence.
Resolution criteria: one paragraph in §15 stating explicitly that `StartupArtifactsV2` is removed from the first landing, that new tooling supplies the v1 carrier with `seed` absent for versioned projects, and that versioned install on sessions targets occurs only post-activation through the named operations.

**C3. The predecessor-evidence conformance row has no named mechanism.** Severity: moderate. **MATERIAL.**
Evidence: §15.5 requires running "the unmodified prior binary's legacy reset against a versioned store," and "unexplained skips fail." No prior-binary test infrastructure exists anywhere in `tests/`, `scripts/`, or CI (verified by search), and building a pinned predecessor in CI is expensive in this repo (Ibex/Hermes bootstrap). The row is the keystone evidence for §15.1's compatibility fence, so it cannot quietly become a simulation.
Resolution criteria: name the predecessor artifact source (pinned released binary, cached prior build, or an explicitly justified feature-stripped build) and where the manifest records it, or define an explicit reasoned-skip class for environments that cannot supply one.

**C4. §5.1/§4.1's "wrong stream → corrupt" classification contradicts §15.1's historical-row semantics.** Severity: moderate. **DETAIL.**
Evidence: §5.1's corrupt row includes "wrong app/stream," and §4.1 calls a record "whose `appId` or stream does not match the active instance" corrupt. Under §15.1 an other-stream row is unreachable by the keyed active read and explicitly "historical," never corrupt — that distinction *is* the round-2 fix (corrupt blocks seed/admin/migration effects; historical does not). An implementer who scans the table per §5.1 instead of point-reading the active key reintroduces the predecessor wedge.
Resolution criteria: amend §5.1/§4.1 to scope `corrupt` to the active-stream record (malformed row at the current key, embedded app/stream inconsistent with the row key, receipt inconsistency) and state that other-stream rows are historical.

**C5. The §9 diagnostics registry is incomplete for §15, and `SNAPBACK_SEED_MODE_PENDING` is likely unreachable under §15.3's transport.** Severity: minor. **DETAIL.**
Evidence: `SNAPBACK_SEED_CROSS_MODE_UNSUPPORTED`, `SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED`, and `SNAPBACK_SEED_OPERATION_ID_REUSED` appear only in §15; §9's stable table and HTTP registration don't cover them. Separately, §3.1.1's `SNAPBACK_SEED_MODE_PENDING` made sense when install rode `/app/ensure` (the one path exempt from the pending fence, `src/server.rs:7987`); on dedicated `/_snapback/api/app/seed/*` routes the existing fence fires first with `SNAPBACK_AUTH_MODE_PENDING` (503, `src/server.rs:20278-20328`), and §9's own precedence rule (existing auth diagnostics win) makes the seed-specific code dead.
Resolution criteria: add the three §15 codes with HTTP classes to §9, and either drop `SNAPBACK_SEED_MODE_PENDING` in favor of the existing code or state exactly where it fires ahead of the generic fence.

**C6. `matched` in the receipt vocabulary vs. the effectful-operations journal.** Severity: minor. **DETAIL.**
Evidence: §15.4's receipt outcome set includes `matched`, but `_snapback_seed_operations_v1` "stores completed effectful operations." If `matched` is journaled, every dev-loop startup (fresh `operationId`) grows the table, contradicting §4.2's no-churn guarantee; if not journaled, "an operation id is globally unique within the database" is unenforceable for matched operations and matched responses are not replayable by id.
Resolution criteria: state that `matched` returns a receipt without writing an operations row and scope id-uniqueness to effectful operations (or specify the dedup).

**C7. Corpus citation inaccuracies (cluster).** Severity: minor. **DETAIL.**
Evidence: §7.2 says `seedTransition` participates in "LLP 0081's length-framed `planDigest`" — 0081's `planDigest` is prefix+`\n`+JCS (0081:177-179); length-framing belongs to `ContentDigestV1` (0081:495-506). §4.1's "LLP 0081's local audience" — no such term exists; 0081 has LLP 0072's target audience, and the data-version stream is LLP 0043/0053's `versionStreamId` (crosswalk in 0091:376-388). "`migration-plan-v1` is closed" — the artifact is `MigrationPlanArtifactV1`, and 0081 states no members-require-v2 rule. "`StartupArtifactsV1`" — neither 0058 nor the code uses that name (`StartupArtifacts`, `formatVersion: 1`). §15.3's "LLP 0059's reset registry" — 0059 has no registry; its obligation is the single-coordinator rule (0059:1620-1623). §3.2's "older hosted ensure variants remain open" — hosted kit decoders are open by *current* decision (0094:719-731). §5.3 attributes the outcome tokens to LLP 0034; the semantics are 0034's but the tokens are implementation/schema facts.
Resolution criteria: correct the citations in place; none changes the design.

**C8. The reconciliation list omits LLP 0024; Related omits LLP 0043.** Severity: minor. **DETAIL.**
Evidence: the host-op surface is pinned by LLP 0024 (`src/host_ops.rs:1-5`; 0024's operation/CLI/MCP tables), and LLP 0031:643-645 explicitly requires "add an `app.seed` noun to LLP 0024 first." §14 and §15.3 name 0012/0094/0034/0031/0040/0058/0059/0080/0081 but never 0024. The Related header also omits LLP 0043, whose `versionStreamId` is now the identity keystone.
Resolution criteria: add LLP 0024 to §14's amendment list and LLP 0043 to Related.

**C9. The capability-manifest member is unnamed in the normative section.** Severity: minor. **DETAIL.**
Evidence: §3.2's `supportedEnsureProtocols` is a new manifest member existing nowhere (schema top-level verified), while the shipped manifest already carries protocol-shaped tokens in `supportedCapabilities` (`auth.sessions.v1`, `migration_keyset_scan_v1`) and 0012:281-293 owns the absent-means-unsupported doctrine. §15.3 says only "manifest capability preflight."
Resolution criteria: §15 names the exact member — either reuse `supportedCapabilities` for the two tokens or keep the new member and note the Rust-type + 0037 drift-gate + 0012-amendment work it entails.

**C10. "Runtime preflights the complete derived count before mutation" overstates static knowability.** Severity: minor. **DETAIL.**
Evidence: derived fan-out is data-dependent; the existing mechanism pairs an activation-time static budget proof (`src/local.rs:14749-14757`) with in-transaction enforcement and rollback (`src/storage.rs:5592`), and §12.2 itself says "roll back on fan-out overflow."
Resolution criteria: align §15.5's wording with the two-layer mechanism (static proof where computable, transactional enforcement with rollback otherwise).

## 4. Suggestions

- Before acceptance, fold §15 back into the body rather than shipping a self-superseding document — the corpus treats LLPs as living documents, and the §3.1/§3.3 carriers, §9 status table, and §12 matrix now read as normative while being dead. At minimum, stamp superseded subsections with a one-line pointer to §15.
- Have `VERSIONED_SEED_MAX_EFFECTS_V1` also replace the two bare `1024` literals (`src/storage.rs:5592`, `src/local.rs:14749`) so the bound has one name.
- Add a compatibility note plus a negative fixture for the silent-drop hazard: nested legacy `SeedData` is an open struct, so a versioned source object fed through any legacy carrier silently loses `seedVersion` and seeds untracked. The later versioned install refuses rather than adopts (safe), but the spec should say the refusal is the *intended* recovery for that mistake.
- §15.4's "database, WAL, … byte-identical" preview test will be brittle against incidental SQLite WAL activity; consider specifying logical-state identity (all tables plus meta dumped and compared) as the conformance form of the same guarantee.
- The digest-prefix landscape now has four conventions (`sha256:` full hex, bare hex, truncated `sha256:`, `cdv1:`). The spec is internally explicit, which suffices, but a one-line note on why request digests are bare while artifact digests carry `sha256:` would prevent a future "normalization" regression.

## 5. Open questions

1. Is the hosted compiled-seed arm intended to appear in `versioned-seed-v1.manifest.json` as a machine-readable GAP row, or is it wholly out of the v1 manifest (and if so, what blocks a hosted target from advertising the capability bits)?
2. What is the predecessor-binary source for the §15.5 evidence row in CI — pinned release, cached build, or something else?
3. §15.2 refuses membership seed only in sessions mode; dev-mode membership seed (via the existing `MembershipWriter::Seed` machinery) therefore remains admitted in v1 — intended?
4. Is the HTTP response body for the four routes exactly the §15.4 receipt object (and `SeedPreviewResultV1` for preview), with the host-op form wrapped in the standard `hostOpsResult` envelope? The text implies but never states it.

## 6. Readiness verdict

The design core — stream-keyed identity with the predecessor fence, the three effectful operations in the existing single reset transaction, non-destructive refusal everywhere, real gates and predecessor-unknown names, an established ceiling, and a conformance manifest with enforcement precedent — is verified sound and implementable in this repository. The MATERIAL concerns are scope-clarity and harness-mechanism gaps, each resolvable with a paragraph or a sentence inside the reconciliation pass the document already commits to in §14; none reopens the design.

VERDICT: READY
