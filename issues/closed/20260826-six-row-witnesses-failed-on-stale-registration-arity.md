# Six CLOSED row witnesses failed on stale OAuth-registration arity

**Status:** closed — the witnesses were repaired and re-executed in all four cells
**Found:** 2026-08-26, during the F145 evidence-drift audit.

## What happened

F171, F172, F173, F188, F190, and F191 each called
`LocalSnapback::register_oauth_client` with the removed caller-supplied
`AgentsMode::Open` argument. Rustc therefore emitted `E0061` at the broad `@attack` statement before
execution could reach the foreign-authority producer that each ledger note claimed was refusing the
attack.

The six rows were scored CLOSED for a mechanical setup failure. None recorded an `expectedCode`, so
the runner correctly confirmed that the error overlapped `@attack` but had no diagnostic contract
with which to reject the false evidence.

## Resolution

The obsolete argument and imports were removed from all six witnesses. Direct execution through the
row runner's `observeAttack` path then produced, in every declared feature cell:

```text
foreign authority producer refused: ... code: "SNAPBACK_AUTH_POLICY_UNAVAILABLE" ...
message: "authority admission belongs to another engine graph"
```

The refusal is now a runtime observation from `prepare_bearer_authority`, before the OAuth or grant
effect named by each row. These are runtime-refusal witnesses, so no Rust `expectedCode` exists to
record. The row verdicts remain CLOSED.

The same audit updated nine ledger notes (F112, F113, C006, F115, F149, F150, F279, F280, C012) that
still described their pre-closure behavior even though their recorded and observed compiler codes
already matched, and added the observed additive-cell `E0599` to F175.

The canonical runner initially stopped at inventory validation because five newly mapped attacks
(F314–F318) had not been subtracted from the security ledger's frozen unmapped debt. The exact
checked-in set was measured as 71 IDs with SHA-256
`fef60ba807c558d05b72697a12b692c0851f2a4a8dc16e53ed1c94ff92b05070`; updating that count and
digest restored the inventory join without changing any attack or verdict.
