# LLP 0109 acceptance — land the §14 reconciliation set across nine owners

**Status:** Resolved (2026-08-03)
**Commissioned:** Charlie Cheever, 2026-08-03 — explicit commission
extending author decision sitting #2
(`issues/20260803-author-decision-sitting-2.md`): write the reconciliation
amendments LLP 0109 §14 requires in its owner documents, then accept 0109.

## What §14 required

LLP 0109 (versioned seed evolution, at Review) gated its own acceptance on
reconciliation amendments in: LLP 0012 and LLP 0094 (the new closed
request/response/reset families), LLP 0034 (explicit exception to legacy
seed-if-empty), LLP 0031 (gated decode/redaction), LLP 0040 (compiled
artifact identity), LLP 0058 (StartupArtifactsV2 stage/consume), LLP 0059
(idempotent predecessor-bound reset), LLP 0080 (projection maintenance),
and LLP 0081 (migration-plan-v2 seed transition/restore/rollback
publication).

## What landed (all dated 2026-08-03, this change)

- **LLP 0012** — new end-of-doc amendment: versioned seed is a separate
  closed family (no `install` intent added to `/app/ensure`; §15.3
  supersedes the §3.1 sketch), capability preflight ids, no legacy
  downgrade, and the implemented status-mapper rows (seed conflict family
  409, declaration failures 400, `SNAPBACK_AUTH_MODE_PENDING` 503 wins).
- **LLP 0094** — new end-of-doc amendment: the families land outside wire
  v1's client-visible matrix under `/_snapback/api/app/seed/*` (LLP 0031
  owns them); `/app/ensure` §0C.1/§0C.2 rows unchanged; host bodies only
  under `HostOpsRequest.input`; hosted arm advertises neither capability id
  (compiled-seed custody is the declared conformance GAP).
- **LLP 0034** — new §10.10: legacy untagged/`provision` seed-if-empty
  semantics unchanged and never write versioned identity; versioned install
  never routes through seed-if-empty; legacy success/skip is never
  retroactive identity evidence; legacy reset clears versioned identity.
- **LLP 0031** — the existing 2026-07-27 versioned-seed route-family
  amendment (which already carried gate-before-decode) gained a dated
  supplement: normative gate order including read-only preview under
  `AdminWrite + NonProd`, and the redaction-bounded response posture with
  `AdminSecretRead` as the sole gated-detail lane.
- **LLP 0040** — new dated amendment: the compiled-seed invariant extends
  to `SeedArtifactV1` identity (caller bytes attest, only exact-identity
  compiled bytes write); the hosted arm is the manifest's declared GAP and
  advertises neither versioned-seed capability.
- **LLP 0058** — new dated amendment: the specified `StartupArtifactsV2`
  stage/consume composition recorded, plus the first landing's deferral of
  that carrier (`SNAPBACK_SEED_CROSS_MODE_UNSUPPORTED` before any stage;
  named `app.seed.*` operations only after sessions activation; §8/§18
  membership ordering). No `StartupArtifactsV2` implementation claimed.
- **LLP 0059** — the existing 2026-07-27 coordinator-reuse amendment gained
  a dated companion: operation-id/request-digest/expected-stream binding,
  same-transaction `_snapback_seed_operations_v1` journal (no separate
  publication phase), replay that observes current state
  (`SNAPBACK_SEED_OPERATION_HISTORICAL`/`_OPERATION_ID_REUSED`), `matched`
  as pure observation.
- **LLP 0080** — new end-of-doc amendment: seed install/reset-install are
  sanctioned bulk writers through the real projection-maintenance path;
  the 1,024 effect ceiling counts this RFC's observable effects
  (`directApplicationRows + distinctChangedProjectionOutputRows`);
  projection outputs are never seed targets; no semantics change.
- **LLP 0081** — new dated amendment: seed never substitutes for migration;
  the specified `migration-plan-v2` `seedTransition` binding
  (`migration-plan-v1` unchanged) with publication-time identity advance
  and truthful rollback/restore receipts; the first landing's removal of
  v2/restore-rebase/rollback-republish from v1 (reset-install is the
  remedy; restore rotates the stream so restored targets have absent
  identity). No `migration-plan-v2` implementation claimed.

## Outcome

All nine reconciliations landed faithfully; no ambiguity between materially
different readings arose, so none was left unamended.
`llp/0109-versioned-seed-evolution.spec.md` flipped Review → Accepted
(Revised 2026-08-03) with §14 rewritten as the dated acceptance record.

## Doc-vs-shipped-code observations (recorded, not papered over)

The first landing's shipped surface matches §15/§16 (which normatively
supersede the earlier general sections), with three notes:

- `SNAPBACK_SEED_EVOLUTION_REQUIRED` (§5.2/§9) and
  `SNAPBACK_SEED_DIGEST_MISMATCH` (§9) are not emitted as distinct codes;
  the shipped narrowing folds them into
  `SNAPBACK_SEED_MIGRATION_REQUIRED` (409) and
  `SNAPBACK_SEED_DECLARATION_INVALID` (400) respectively, consistent with
  §15.5's first-landing code list.
- Two implementation-added guard codes exist beyond 0109's tables, both
  409: `SNAPBACK_SEED_IDENTITY_CONFLICT` (active-installation insert
  collision, src/seed_identity.rs) and
  `SNAPBACK_SEED_REPLAY_REQUIRES_PREFLIGHT` (replay must complete before
  the reset coordinator, src/storage.rs). Registered in LLP 0012's mapper
  amendment.
- `SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED` remains allow-listed in
  the status mapper although §18 retired it from the sessions membership
  lane; retention is harmless allow-list residue, noted in the LLP 0012
  amendment.
