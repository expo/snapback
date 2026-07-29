# Research Room / Snapback remediation-2 confirmation

This handoff is additive evidence from a Stage 4 confirmation rerun at the
imported repair commit
`894ddaf99d4b7681499eec12ecbb3fc7a1a492e5`. It does not replace or edit the
sealed LLP 0102 capsule, frozen receipts, shared diary, ledger, report, or
scoring files.

## Result

- Frozen checks recorded: 15 of 15.
- PASS: 13.
- Explicit capability GAP: 2 (`RESEARCH-02-FILES` and
  `RESEARCH-05-SEMANTIC`).
- FAIL: 0.
- Stop-class defects: none.
- Target: fresh local packaged SQLite + Ibex sessions deployment.
- Cleanup: exact runtime and public paths absent; isolated ports 3351, 4351,
  9351, and 20451 closed; no cleanup errors.

The sealed first attempt recorded 1 PASS, 2 GAP, and 12 FAIL because the
sessions/streamed-action composition was rejected before bind. The repaired
exact instance admitted the application, minted Alice, Bob, and Mallory
sessions, and exercised real multi-session push, cancellation with no late
durable patch, retry identity, explicit settlement outcomes, cron/config,
2+7 performance samples, and exact cleanup.

## Isolation and external-copy adaptations

The sealed `work/` directory was copied to an external temporary root. Only
that copy was adapted:

1. Repository/runtime paths, target namespace, and four ports were isolated.
2. The frozen bootstrap's two owner bootstraps plus two Bob membership inserts
   in one invocation produced `SNAPBACK_MEMBERSHIP_BATCH_UNSUPPORTED`, because
   the v1 runtime permits one generated membership write per mutation. The
   copied setup was split into four idempotent invocations. It still created
   the same two rooms, Alice/Bob memberships, two room-view rows per room, and
   20 frozen sources in the primary room.
3. The copied scheduled action's deterministic receiver port followed the
   isolated effect port.
4. The copied schedule harness used Alice's external session plus the admin
   capability for cron/action calls, and supplied the required
   `x-snapback-auth-client-protocol: 1` offer to public `/inspect`. A probe of
   sensitive `/_snapback/api/inspect` correctly returned 401 without the
   separate secret-read lease, so it was not misrepresented as a public route.
5. A copied-runner schedule step receipt was added to distinguish product
   execution from harness inspection failures.

No frozen scenario ID, expected fact, scenario assertion, application UI
behavior, source fixture, effect semantics, or product source was relaxed.
Hashes for every adapted copied file are in `inventory.v1.json`.

## Evidence map

- `confirmation-capsule.v1.json`: capsule-equivalent frozen-protocol mapping.
- `acceptance.v1.json`: complete per-scenario evidence and milestones.
- `performance.v1.json`: required 2 warmups plus 7 recorded samples.
- `target-identity.v1.json`: exact commit, namespace, app, generated-input, and
  port identity.
- `cleanup-plan.v1.json` and `cleanup.v1.json`: exact owned targets and
  post-cleanup proof.
- `secret-redaction.v1.json`: redacted config/receiver evidence.
- `asset-gap.v1.json` and `semantic-gap.v1.json`: explicit nonclaims.
- `research-room-ui.png`: production UI evidence.
- `commands-and-failures.v1.json` and `schedule-steps.v1.json`: command and
  schedule trace.
- `verification.v1.json`: capsule, path, secret, reference, guide, and
  whitespace checks.
- `diary-entry-draft.md`: coordinator-owned serialized diary draft.
- `llp-maintain-audit.md`: propose-only LLP drift audit.
