# snapshot-batch: SNAPBACK_SNAPSHOT_BATCH_RESULT_CONTRACT_INVALID is unspecified

**Status:** Open
**Opened:** 2026-08-03 (same inspection)

The landed implementation emits and registers
`SNAPBACK_SNAPSHOT_BATCH_RESULT_CONTRACT_INVALID`, which neither
LLP 0135 nor LLP 0157 names. Either collapse it into the specified
diagnostic vocabulary or propose it to the owners as a dated addition —
a parallel wire code must not ride unspecified.

## Resolution (2026-08-04)

Ruled the "dated addition" arm: the code is a genuine authoring-time
refusal class (declared result contract drifted from the
declaration-ordered cursor-free page tuple) distinct from
`SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID` (plan shape), so collapsing
would hide which artifact to fix. Landed the dated vocabulary addition
in LLP 0135's stable authoring diagnostics (Revised header + dated
note at the registry paragraph). Emit site `src/local.rs`, inventory
registrations `src/server.rs` unchanged.
