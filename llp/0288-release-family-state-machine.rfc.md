# LLP 0288: A durable release-family state machine

**Type:** RFC
**Status:** Draft
**Systems:** Packaging, Distribution, Verification, Project
**Author:** codex `gpt-5.6-sol` (commissioned by Claude Opus 5 orchestrating LLP 0283 F-6),
for Charlie Cheever
**Date:** 2026-08-19
**Revised:** 2026-08-19 (a — initial design)
**Related:** LLP 0283 (F-6), LLP 0276 (D5), LLP 0041, LLP 0233, LLP 0189, LLP 0232, LLP 0286, LLP 0287

> **Provenance.** LLP 0283 F-6 defers three programs, each "deserving its own reviewed
> design." This is one of the three. It was authored against the tree by a model family
> independent of the code it regroups, per LLP 0283's F-2 method lesson: do not let a lane
> write the design that constrains it. It is **Draft** — it has not yet been through the
> LLP 0005 review loop, and no implementation is authorized by it.

## Status and decision

Build one durable state machine for a complete Snapback package family and route both the qualified and rapid-publication profiles through it.

Do not create a competing design beside LLP 0233. LLP 0233 already proposes continuous candidate preparation and a resumable state sequence (`llp/0233-continuous-qualified-npm-release.rfc.md:137`, `llp/0233-continuous-qualified-npm-release.rfc.md:261`), but it remains Draft and explicitly changes no current authority (`llp/0233-continuous-qualified-npm-release.rfc.md:556`). This design should be reviewed as the completion/reconciliation of that RFC’s D6, not as a second release protocol.

No real publication cutover occurs while LLP 0283 F-1 blocks npm publication (`llp/0283-post-rearchitecture-followups.plan.md:42`, `llp/0283-post-rearchitecture-followups.plan.md:50`).

## The problem in the current tree

Snapback’s current publication logic is several locally coherent protocols without one family-wide durable state.

### Candidate publication has a row journal

`snapback-publish.mjs` publishes each package under a non-default tag, records `published`, `skipped-already-published`, or `publish-failed`, and writes the ledger after each row (`scripts/snapback-publish.mjs:626`, `scripts/snapback-publish.mjs:643`, `scripts/snapback-publish.mjs:660`). It closes a candidate ledger only after every package’s registry bytes and tag agree (`scripts/snapback-publish.mjs:679`, `scripts/snapback-publish.mjs:689`).

This is resumable candidate publication, but it is not a release-family machine.

### Qualified promotion has a robust mutation transaction

The standing publication authority is already durable and single-headed. It stores signed issue/acquire/close transitions in SQLite with full synchronization and replay validation (`packages/snapback-publication-authority/README.md:25`). New leases require the full current package closure (`packages/snapback-publication-authority/authority.mjs:213`, `packages/snapback-publication-authority/authority.mjs:217`), acquisition is idempotent (`packages/snapback-publication-authority/authority.mjs:318`), and close accepts only promoted or rolled-back terminal vectors (`packages/snapback-publication-authority/authority.mjs:386`).

`snapback-promote.mjs` journals events throughout the tag transition (`scripts/snapback-promote.mjs:691`, `scripts/snapback-promote.mjs:734`) and attempts strict rollback on failure (`scripts/snapback-promote.mjs:837`, `scripts/snapback-promote.mjs:852`). This is a good promotion submachine.

### The fast path is a separate, weaker machine

The fast path writes its own ceremony with publication, byte verification, smoke, and final-tag arrays (`scripts/snapback-fastpath-release.mjs:857`). It can resume a partially published version by reusing a matching pass-two ledger (`scripts/snapback-fastpath-release.mjs:803`).

After smoke, however, it moves `latest` in a direct serial loop (`scripts/snapback-fastpath-release.mjs:946`) and records an error if the final vector is incomplete (`scripts/snapback-fastpath-release.mjs:959`). It does not use the standing authority’s complete-vector journal and reverse rollback. A halfway failure can therefore leave a mixed `latest` vector requiring manual repair.

That behavior predates and conflicts with the desired family-wide state boundary. The fast path may retain its explicitly weaker qualification profile, but it must not retain a separate default-tag mutation protocol.

### Durable truth is fragmented

Current truth is distributed among:

- qualified staging ledgers;
- candidate ledgers;
- fast-path ceremony files;
- promotion receipts;
- post-promotion ledgers;
- the external authority database;
- EAS/GitHub artifacts;
- `guide/published-closure.json`.

The Guide record currently says `newestPublished` and `newestQualified` are 0.1.24 (`guide/published-closure.json:5`, `guide/published-closure.json:7`). Its update protocol is prose inside the record (`guide/published-closure.json:8`).

The checked-in publication evidence directory contains complete candidate/promotion records for only part of the release history. I did not find committed family receipts for 0.1.22–0.1.24 there; they may exist externally. The new machine must not fabricate backfilled evidence.

The package family is currently 13 names (`scripts/snapback-publish-core.mjs:62`). The authority independently carries an ordered 13-name promotion vector plus historical 11- and 12-name prefix widths (`packages/snapback-publication-authority/protocol.mjs:38`, `packages/snapback-publication-authority/protocol.mjs:58`). This duplicated family definition is another drift point.

## Release-family identity

One release family is identified by:

- family version;
- source revision;
- scope preset;
- ordered public package vector;
- staged tarball digest vector;
- package-inventory digest;
- qualification profile;
- claim-scope digest;
- operation ID.

The current family uses one version across all packages, but the state shape records a vector rather than assuming permanent uniformity.

Once any package version is accepted by npm, the family identity and bytes are immutable. A different source, tarball vector, qualification profile, or claim scope requires a successor family or, before publication, a new staging generation.

## Durable representation

### Authoritative mutable state

Extend the standing publication authority’s durable SQLite store to hold the release-family operation journal, not merely the latest-tag lease states.

This is the authority because it:

- survives publisher process death and checkout deletion;
- already provides monotone compare-and-swap transitions;
- already signs replayable receipts;
- already serializes default-tag mutations independently of npm credentials.

Before each external effect, the machine durably records intent with a stable effect ID. After the effect, it records the observed result. Retrying an effect first reopens npm or the remote proof provider and either accepts the exact already-completed result or refuses ambiguity.

Large receipts remain in bounded artifact storage; the authority record retains their canonical digests, identities, and availability state.

### Checked-in historical projection

After a family reaches a closed state, generate:

`tests/acceptance/publication/families/<version>/family-record.json`

This immutable record contains the signed authority terminal record, evidence digests, package vector, qualification scope, promotion events, final disposition, and links to retained receipts. Existing candidate and post-promotion files remain historical inputs; they are not rewritten.

A new genesis record starts the state-machine epoch from the observed current 0.1.24 family. It must say `legacy-observed` for evidence that cannot be reconstructed. It may cite the current Guide record, registry observations, and retained documents, but it must not claim missing receipts.

### Generated projections

- `guide/published-closure.json` becomes generated from the newest closed family records.
- A release-history projection reports qualified, rapid, superseded, abandoned, rolled-back, known-red, and withdrawn families.
- The current ordered package inventory is generated from one release-family definition and consumed by both publisher and authority.
- An offline `release-family-inventory` gate checks schemas, digests, monotonicity, package vectors, evidence lineage, and Guide projections.
- A networked scheduled/pre-release audit reopens npm tags and exact versions. It is not an ordinary landing gate.

A failure to commit the repository projection after npm promotion does not rewrite external reality. The authoritative state becomes `RELEASED` with `projectionStatus=RED`; repair of the projection is mandatory before another release, but automatic rollback is not inferred.

## State model

The durable state is a product of three axes:

1. artifact phase;
2. promotion phase;
3. standing health.

This avoids treating a later health red as if immutable package bytes had returned to an earlier build phase.

### Artifact and promotion states

| State | Required evidence and legal next states |
|---|---|
| `RESERVED` | Version reservation, source revision, package vector, qualification profile, claim scope, and proof-inventory digest are durably bound. npm confirms no package in the family already owns that version. Next: `STAGED` or `SUPERSEDED_UNPUBLISHED`. |
| `STAGED` | Clean source-bound tarballs, sealed runtime binaries, store qualification, staged ledger, scoped qualification digest, and source/package identity all validate. A new staging generation may supersede this generation only while no npm bytes exist. Next: `PUBLISHING`, `SUPERSEDED_UNPUBLISHED`, or hard refusal. |
| `PUBLISHING` | At least one immutable candidate publication intent exists. Per-package effects record absent, published, or exact-already-published observations. Retry stays here. Next: `CANDIDATE`, `ABANDONED`, or `RECONCILIATION_REQUIRED`. |
| `CANDIDATE` | Every exact version exists under the source-bound non-default tag; registry re-download digests equal the staged vector. Next: `PROVEN` or `ABANDONED`. |
| `PROVEN` | The qualification-profile-specific public consumer evidence is complete. Next: `READY`, evidence-refresh generation, or `ABANDONED`. |
| `READY` | LLP 0189 D-6 is satisfied: green scoped evidence and the newest eligible complete battery is green on claim-relevant gates; unrelated reds are named and ticketed. Exact-current obligations such as telemetry are valid. Next: `AUTHORIZED`, readiness refresh, or `ABANDONED`. |
| `AUTHORIZED` | Complete prior `latest` vector and prior closure are retained; a signed external lease binds the candidate, prior vector, intended vector, operation ID, and evidence digests. Next: `PROMOTING`, `ROLLING_BACK`, or `RECONCILIATION_REQUIRED`. |
| `PROMOTING` | Each `latest` mutation has a durable intent, pre-vector, authority head, command result, and post-vector observation. Next: remain `PROMOTING`, `ROLLING_BACK`, `RELEASED`, or `RECONCILIATION_REQUIRED`. |
| `ROLLING_BACK` | Reverse-order mutations target only this operation’s exact changed rows. Next: `ROLLED_BACK` or `RECONCILIATION_REQUIRED`. |
| `ROLLED_BACK` | Exact prior vector is re-observed and the authority closes the epoch as rolled back. Candidate versions remain immutable and quarantined. Terminal for this release attempt; a successor patch is required. |
| `RECONCILIATION_REQUIRED` | Registry or authority truth is ambiguous. All release mutation is blocked. Exit only through an explicitly authorized reconciler that proves the exact intended or prior vector and obtains a signed terminal closure. |
| `RELEASED` | Intended vector is stable, required `latest` install/boot evidence passes, post-promotion ledger is closed, and the authority returns a signed promoted closure. Artifact/promotion phase is terminal. |
| `SUPERSEDED_UNPUBLISHED` | A newer chosen source replaces a reserved or staged family before npm accepts any bytes. The version may be reused only if registry absence is re-proved and policy explicitly permits it; safer default is to consume a successor version. |
| `ABANDONED` | Candidate bytes exist but will not be promoted because of semantic proof failure, byte mismatch, invalid scope, or operator withdrawal. Exact versions are never reused. |

Transient infrastructure failures do not automatically create `ABANDONED`. They append a retryable event and leave the family in its current phase. Semantic failure or byte inconsistency is terminal.

`READY → READY` is a legal evidence-refresh transition: it adds a new currentness/battery evidence generation without rewriting the immutable candidate evidence.

### Qualification profiles

The profile is bound at `RESERVED` and cannot be downgraded later.

- `qualified` requires the complete two-platform qualified-staging and public-consumer evidence. A released family may advance both `newestPublished` and `newestQualified`.
- `rapid` preserves LLP 0041’s explicit fast-publication profile: sealed runtimes, both packaged-store receipts, complete byte verification, exact-version installed boot smoke, and the common authorized promotion protocol. It may advance `newestPublished`, but not `newestQualified`, unless the missing qualified evidence is later completed as an append-only evidence generation.

Both profiles use the same `PUBLISHING` and `PROMOTING` engines. The current direct fast-path `latest` loop is retired.

### Standing health states

After `RELEASED`, a separate health state is maintained:

| State | Meaning |
|---|---|
| `CURRENT` | It is the default family and no claim-relevant known red stands. |
| `SUPERSEDED` | A later family closed successfully and became the complete default vector. The older exact family remains valid historical evidence. |
| `KNOWN_RED` | A claim-relevant scheduled battery or audit is red and linked to its ticket. This is visible but not automatically equivalent to factual invalidity, matching LLP 0189 D-1/D-3 (`llp/0189-verification-cadence-and-claim-gating.decision.md:108`, `llp/0189-verification-cadence-and-claim-gating.decision.md:143`). |
| `WITHDRAWAL_PENDING` | Triage established factual invalidity or unsafe default use; a separately authorized recovery transition is required. |
| `WITHDRAWN` | A safe complete vector has replaced it, its non-default release tags have been removed where appropriate, and registry deprecation annotations have been applied and re-observed. Exact versions remain retrievable. |

No post-close automatic rollback is authorized merely because an asynchronous audit fails. That would require a separate author ruling, consistent with LLP 0233’s current boundary (`llp/0233-continuous-qualified-npm-release.rfc.md:318`, `llp/0233-continuous-qualified-npm-release.rfc.md:326`).

## Superseding and yanking under npm immutability

### Before candidate publication

A `RESERVED` or `STAGED` family may be `SUPERSEDED_UNPUBLISHED`. Its receipts remain as history. No npm action is needed.

### After candidate publication but before release

A failed or stale candidate becomes `ABANDONED`. The holding tag may be removed only after the full exact package vector and abandonment record are retained. The versions remain installable by exact version and are never reused.

### After release

Normal supersession occurs only when a successor family reaches `RELEASED` and the authority closes the new complete vector. The old family becomes `SUPERSEDED`.

“Yank” cannot mean deletion:

- npm versions and the sealed binary remain immutable;
- exact-version installation cannot be prevented reliably;
- removing a tag changes discovery, not the stored artifact.

Therefore `WITHDRAWN` means:

1. a new authorized epoch moves `latest` to a known-good complete vector;
2. obsolete holding/default aliases are removed where safe;
3. all package versions receive a consistent deprecation advisory when the registry supports it;
4. Guide and release-history projections mark the family withdrawn and name the reason/successor;
5. exact artifacts and evidence remain available for lineage.

A withdrawn family is never erased or republished.

## LLP 0189 and LLP 0232 integration

The release record binds:

- qualification commit;
- claim-relevant source/checker scope;
- scoped qualification digest;
- canonical proof-inventory digest;
- derived claim-relevant gate IDs;
- newest eligible complete battery run and tested revision;
- unrelated red tickets;
- exact-current evidence explicitly required by a governing claim.

The candidate need not be current `HEAD`. The newest eligible battery must contain the qualification commit, be no older than two scheduled periods, and be the newest eligible completed run (`llp/0189-verification-cadence-and-claim-gating.decision.md:217`).

A newer unrelated `main` commit does not invalidate the family. A newer claim-relevant change becomes the next candidate after immutable publication unless the current candidate is factually wrong. No quiet-main window is introduced.

Ordinary landings retain LLP 0232’s optimistic behavior. Candidate publication and `latest` promotion remain strict because they are irreversible external effects (`llp/0232-green-pointer-development-model.rfc.md:320`).

## Halfway publication failures

### Failure before npm accepts any package

Remain `RESERVED` or `STAGED`. A new staging generation may be produced after revalidating source and scope. No registry recovery is needed.

### Failure after some candidate packages publish

Remain `PUBLISHING`.

On restart, for every package:

- absent version: publish using the same effect ID;
- present version with exact expected registry digest and holding tag: record exact-already-completed and continue;
- present version with any different digest or identity: enter `ABANDONED` or `RECONCILIATION_REQUIRED`; never overwrite or reuse the version.

A partial candidate family never moves `latest`.

### Failure after candidate publication but during proof

Infrastructure failure is retryable from `CANDIDATE`. Semantic proof failure yields `ABANDONED`. The holding tag may be removed after evidence retention, but exact versions remain.

### Failure during `latest` movement

Enter `ROLLING_BACK` using the current promoter’s complete-vector, reverse-order semantics. If the exact prior vector is restored and the authority closes it, finish `ROLLED_BACK`.

If any registry observation is unreadable, a mutation response is ambiguous, the lease is lost, or an unrelated vector change appears, enter `RECONCILIATION_REQUIRED`. Do not guess, acquire another ordinary lease, or overwrite a newer value.

### Failure after all tags move but before close

Reopen the complete vector, fresh-cache install result, post-promotion ledger, and signed authority head.

- If all required release evidence exists and the authority already closed as promoted, replay/reconstruct `RELEASED`.
- If evidence failed and the lease remains usable, roll back.
- If the vector or authority state is ambiguous, reconcile.
- A local receipt-write failure never turns an unproven observed vector into success.

### Failure after signed close but before repository projection

The family is already `RELEASED`; npm is public. Set `projectionStatus=RED`, retain the signed close, and repair the checked-in family/Guide projections. Do not roll back solely because Git publication metadata failed.

## Staged migration

### Stage 0 — reconcile the governing documents

Amend LLP 0041 and LLP 0233 into one accepted state vocabulary. Explicitly rule on:

- rapid versus qualified evidence profiles;
- removal of the fast path’s direct `latest` mutation;
- post-close withdrawal authority;
- external authority storage of pre-promotion family states.

No runtime or registry behavior changes.

### Stage 1 — state schemas, validator, and legacy import

Implement the closed state/event schemas and pure transition validator. Import existing checked-in 0.1.18–0.1.21 evidence where complete. Create an explicitly incomplete `legacy-observed` genesis for 0.1.24 instead of inventing missing history.

Exit criteria:

- every legal transition and every illegal skip has a fixture;
- all historical records validate at their historical package widths;
- current Guide projection remains unchanged;
- no network or npm mutation occurs.

### Stage 2 — shadow current rehearsals

Have qualified staging and fast-path rehearsal emit shadow family events while the existing scripts remain authoritative. Compare projected candidate ledgers, evidence digests, package order, and terminal classifications.

Exit criteria:

- a rehearsal can be interrupted after every phase and resume without repeating a completed local effect;
- shadow records reproduce existing ledgers;
- fault injection covers missing artifacts, substituted receipts, stale scope, and invalid package vectors.

### Stage 3 — candidate publication cutover

Make the family journal authoritative before candidate publication. Existing command paths become adapters to the state machine.

Exit criteria before the first real candidate:

- controlled-registry fixtures inject process death before and after every package publish;
- exact replay never republishes or changes bytes;
- partial publication cannot reach `READY`;
- registry ambiguity yields `RECONCILIATION_REQUIRED`;
- F-1 and F-3 are closed and the release-scoped LLP 0189 evidence is green.

### Stage 4 — common promotion cutover

Route both qualified and rapid profiles through the standing authority and common promoter. Remove the fast path’s direct tag loop.

Exit criteria:

- injected failure before/after every tag mutation returns exactly to the prior vector or enters reconciliation;
- no mixed vector is reported released;
- lost responses are resolved through observation and stable effect IDs;
- signed close and post-promotion ledger agree;
- at least three real families close or safely roll back without manual state edits.

### Stage 5 — generated repository projections and withdrawal

Generate family records and `guide/published-closure.json` from terminal state. Add known-red, supersession, deprecation, withdrawal, and recovery-vector fixtures. Only then remove the old manual update protocol and independent ceremony authorities.

## Exact verification

Required verification includes:

1. closed-schema and canonical-digest fixtures;
2. exhaustive transition-table tests;
3. state replay after process death at every external-effect boundary;
4. controlled-registry partial publication, timeout, stale read, and digest-mismatch fixtures;
5. complete-vector tag mutation and reverse rollback fixtures;
6. authority issue/acquire/close exact-replay tests;
7. rapid and qualified profile non-downgrade tests;
8. LLP 0189 scope and battery eligibility fixtures;
9. unrelated-`main` movement fixtures;
10. projection generation and historical-width validation;
11. post-close known-red, supersession, and withdrawal fixtures;
12. one non-mutating full rehearsal before each implementation stage;
13. the governing release qualification before any real npm effect.

## Failure modes and honest limits

- npm tag updates are not atomic. The machine can bound, journal, and reverse the mixed interval; it cannot eliminate it.
- npm deprecation and tag removal cannot prevent exact-version installs. `WITHDRAWN` is an honesty and default-selection state, not erasure.
- Extending the publication authority makes it more critical. Its SQLite volume needs tested backup, restore, and signed export. Loss of authority state must block mutation rather than fall back to local files.
- Artifact stores may expire or become unavailable. A retained digest proves identity, not continuing retrievability; availability must be a separate state.
- Historical backfill is incomplete. The design deliberately starts with a signed genesis rather than claiming evidence not found in the tree.
- The rapid profile remains weaker than full qualification. Its weaker claim must remain visible, and it must never advance `newestQualified` without the missing evidence.
- A state machine can make effects resumable but cannot decide factual invalidity automatically. Withdrawal remains an explicitly authorized safety action.
- LLP 0233 is still Draft. Implementing a second machine without reconciling it would worsen the exact fragmentation this program is intended to fix.

## Sequencing recommendation

This is second after the proof-inventory unification and before scripts regrouping.

Implementation should be deferred until F-1, F-3, and the next qualified publication restore the release baseline. Once that happens, the state machine should not be deferred again: the current fast path has a materially weaker partial-`latest` failure story than the qualified promoter.

The need should not be declined, but a separate new protocol should be. The correct program is to accept and amend LLP 0233 with this durable family model, funnel every release profile through it, and only then move the release files into `scripts/release/`.
