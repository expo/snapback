# Migration presentation contract v1

This is the deterministic presentation contract for the `snapback migrate`
verbs. It governs human text only. `MigrationPlanArtifactV1`,
`MigrationPreviewObservationV1`, `MigrationApprovalV1`, journal records, and
receipts retain their LLP 0081 authority and schemas unchanged.

The stable presentation identifier is `migration-presentation-v1`, emitted on
every human face and exported as
`MIGRATION_PRESENTATION_CONTRACT_VERSION`. A breaking human-grammar change
mints a new identifier and golden fixture set; it never silently reinterprets
an LLP 0081 artifact version.

<!-- @ref LLP 0160#2-the-ideal-experience-moment-by-moment — stream discipline,
face-specific redaction, plan/approval/receipt rendering, and render-first
approval. -->
<!-- @ref LLP 0160#3-design-principles — render admitted sources, label the
pre-plan carve-out, and omit unavailable facts. -->

## Streams and faces

- Every migrate verb writes the shared structured envelope to stdout.
- Human rendering is default-on to stderr. `migrate --json` silences all human
  rendering, including the human diagnostic summary; the structured envelope
  remains unchanged.
- Every human rendering names `migration-presentation-v1` before its face.
- Preview and approve use the secure review face only when stderr is a terminal.
  It reveals literal plan constants. A piped/CI face is narration and redacts
  constants.
- Apply, rehearse, cancel, verify, and rollback always use narration faces.
  Literal constants, row-derived values, and receipt step-result values are
  redacted.
- Approve renders before authorization and before touching `--out`. Interactive
  callers type `approve`; non-interactive callers pass
  `--acknowledge-digests <planDigest>:<observationDigest>`. A missing, partial,
  or mismatched value refuses with `SNAPBACK_MIGRATION_APPROVAL_REQUIRED` and
  does not create the approval artifact.

## Traceability table

| Rendered phrase | Admitted source | Missing-source behavior |
|---|---|---|
| Presentation contract identity | Fixed `MIGRATION_PRESENTATION_CONTRACT_VERSION` | Required on every human face |
| Plan identity | `/planId`, `/planDigest` | Required artifact fields; invalid artifacts refuse before presentation |
| Target profile | `/body/targetProfileId` | Required plan field |
| Ordered step and target | `/body/steps/*/step`, using the typed step's stable `step_type()` and `qualified_target()` projections | Required step fields |
| Backfill/copy value | `/body/steps/*/step/*` plus `/body/constants/values/*` for `Arg` | Review shows `value unavailable`; narration always shows `[redacted]` |
| `preflight: ~N rows` | Separately digested `/preconditionRows/<stepId>` | Entire estimate and authority-label pair omitted |
| Estimate authority label | Fixed LLP 0081 §2 plan/observation split | Emitted on every estimate line; never omitted while an estimate renders |
| Resource ceilings | `/body/ceilings/*` | Required plan fields |
| Barrier behavior | Fixed LLP 0081 §4 rule, parameterized only by `/body/executionStrategy` | Current artifact has no capability digest, so presentation says plan-bound validation is unavailable; it never claims a validated registry |
| Client posture | `/body/compatibilityPosture`, `/body/retainedWorkPosture`; fixed LLP 0081 §4/§6 consequences | Required plan fields |
| Rollback path | Fixed LLP 0081 §6 rule; `/body/constants/rollbackTimestampMs` only when present | No reverse-plan/restore availability is inferred; presentation says availability is undeclared |
| Proof | `/body/proof` | Required plan field; optional sample bound omitted when absent |
| Plan constants | `/body/constants` | Optional rollback timestamp and named values omitted when absent; values redact by face |
| Observation identity | separately digested observation fields | Required observation fields |
| Approval binding | every field of `MigrationApprovalV1`, plus plan `/body/backup/*` | Audience axes undefined by the local profile render as unavailable, not as empty values |
| Recoverability status | Fixed LLP 0081 §2/§7 rule and the local profile's shipped seven-day maximum | Always says not executed/proven at admission; never renders status as approval authority |
| Receipt identity and journal projection | shipped `MigrationReceiptV1` fields | Optional publication version omitted; absent step results render unavailable |
| Receipt proof results | keys of `/stepResults` only | Values always redact on narration faces |
| Verify explanation | shipped verification projection plus fixed LLP 0081 §5 rule | Missing recorded data proof renders unavailable |
| Rollback receipt | shipped `MigrationRollbackReceiptV1` fields | Required receipt fields only |

## Determinism

- Section and field order is the order committed in
  `src/migration_presentation.rs`; maps use their `BTreeMap` order.
- Standard width is 88 columns. A valid conventional `COLUMNS` value narrows
  output down to a 40-column floor and never widens it beyond 88. Golden
  fixtures pin the standard and 48-column narrow faces.
- Wrapping occurs only at ASCII whitespace. Exact identifiers and digests are
  never split, so a single identity token may exceed the selected width.
- Presentation emits no ANSI sequences or terminal color.
- A successful verb exits 0. A structured migrate refusal exits 1 after writing
  its envelope. Clap usage/parse failures retain Clap's exit 2. `--json` does
  not change exit status.

## Golden fixtures

The committed set under `tests/fixtures/migration-presentation/` pins:

- revealed review face;
- redacted narration face;
- estimate-absent omission;
- 48-column narrow rendering;
- render-first approval binding; and
- narration-face receipt rendering.
