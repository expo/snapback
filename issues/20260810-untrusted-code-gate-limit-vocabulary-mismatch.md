# /api/v1/run untrusted-code gate: required-limit vocabulary can never be satisfied

- **Status:** Open
- **Date:** 2026-08-10
- **Systems:** runtime, capability manifests, external API
- **Found by:** the 2026-08-10 dual-runtime untrusted-code launch investigation
- **Severity:** latent (the gate correctly refuses everything today; this
  blocks the *intended promotion path*, not current behavior)

## The gap

`manifest::untrusted_code_profile_evidenced` (src/manifest.rs, the S4-B
LLP 0204 D6 gate) requires all eight names in
`UNTRUSTED_CODE_REQUIRED_LIMITS` to be reported `Enforced`:

    wall_clock_timeout, action_wall_clock_timeout, cpu_budget,
    maximum_result_size, maximum_rows_read, maximum_rows_written,
    maximum_host_call_count, maximum_heap_size

But the committed capability manifests emit only three of these as
resource-limit rows (`wall_clock_timeout`, `cpu_budget`,
`maximum_result_size`); the other five names appear in NO target's
manifest. The Cloudflare/hosted target additionally reports its row-scale
limits under different names (`maximum_row_bytes`, `maximum_storage_bytes`)
than the gate's `maximum_rows_read` / `_written`.

**Consequence:** the gate as written can never pass for any target, even
one whose runtime genuinely enforces every real limit (the killable
workerd/V8 target). Whenever someone attempts the untrusted-code profile
promotion, they will hit an unsatisfiable check with no enforcement reason
— purely a vocabulary mismatch.

## Fix

Reconcile the gate's required-limit vocabulary with the names targets
actually emit (and the LLP 0047 §Limits list), OR make the gate map
equivalent names. This must land as part of, or before, any untrusted-code
promotion (see the dual-runtime investigation draft's G0). Not urgent — the
refusal is correct today — but it is a precondition for the V8-first
launch path the investigation recommends.
