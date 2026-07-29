# LLP maintenance audit — Chat / Snapback arm

**Intent:** pre-pr
**Scope:** `demos/backend-bakeoff/arms/chat/snapback/`, its diary entry, and
the two linked filesystem issues
**Mode:** propose-only; this audit did not apply LLP, status, or reference
changes

## Deterministic result

- `./ref-check --verbose`: OK — 107 LLP documents, 2,202 refs in 3,545
  files, 0 errors, 0 unchecked.
- The final capsule verifies against the frozen LLP 0102 protocol.
- The arm records the exact 15 Chat scenarios, local target identity,
  direct transport/authority evidence, performance repetitions, retained
  failed attempts, backup manifest, and exact cleanup.

## Findings

1. The schema's non-obvious membership-invalidation and ephemeral-state
   decisions have applicable `@ref` annotations to LLP 0056 and LLP 0013.
   `ref-check` found neither broken nor stale targets.
2. The arm does not change the frozen Snapback implementation. It reproduces
   the already documented protected-row revocation defect, so no new design
   document or competing live issue is proposed. The existing P0 filesystem
   issue now links the independent Chat evidence.
3. The ephemeral stream-readiness friction was knowledge the Guide should have
   supplied. A new `guide-gap` filesystem issue proposes the documentation and
   diagnostic correction required by LLP 0061.
4. The cold protected-history GAP, reservation-stale retry, generated
   ephemeral `unknown` typing, and non-idempotent unsubscribe are comparative
   findings for calibration. They do not by themselves establish that an
   Accepted LLP is stale or that the frozen implementation should be changed
   during the arm.
5. The diary entry preserves the FAIL/GAP distinction and does not claim
   hosted or multi-instance evidence.

## Proposals

- No LLP content, status, tombstone, or `@ref` repair is proposed before this
  arm lands.
- Carry the four product/DX findings into the centralized calibration
  synthesis and remediation ledger after all seven Chat arms finish.
- Rerun the deterministic corpus, Guide, protocol, capsule, evidence-path, and
  secret checks from the coordinator checkout after serialized integration.
