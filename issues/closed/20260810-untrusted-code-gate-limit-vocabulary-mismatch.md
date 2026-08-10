# /api/v1/run untrusted-code gate: required-limit vocabulary can never be satisfied

- **Status:** Closed
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

## Resolution (2026-08-10)

Resolved by making the LLP 0047 §Limits-to-manifest-row mapping explicit in
`src/manifest.rs` and deriving `UNTRUSTED_CODE_REQUIRED_LIMITS` from that
canonical mapping. Query and mutation share the emitted
`wall_clock_timeout` row; action wall-clock remains
`action_wall_clock_timeout`; the remaining canonical names are `cpu_budget`,
`maximum_result_size`, `maximum_rows_read`, `maximum_rows_written`,
`maximum_host_call_count`, and `maximum_heap_size`.

The audit corrected the issue's initial row count: local and remote-service
manifests already emit `action_wall_clock_timeout` as well as
`wall_clock_timeout`, `cpu_budget`, and `maximum_result_size`. The required
semantic set did not lose or alias any name; the change replaces the
free-floating list with the authoritative LLP-to-row mapping.

The producer audit also established that the Cloudflare rows
`maximum_row_bytes` and `maximum_storage_bytes` are not aliases for these
invocation limits: they describe a per-row/BLOB byte ceiling and total Durable
Object storage capacity, respectively. Treating either as rows-read/written or
JavaScript-heap evidence would weaken the gate, so those platform rows do not
satisfy the untrusted-code profile.

A drift-guard test now pins all eight LLP 0047 bullets to the canonical rows,
including the intentional shared query/mutation row and separate read/write
row counters. A synthetic manifest containing exactly the canonical rows as
`Enforced`, with the `hosted_untrusted_code` gap absent, passes the evidence
gate. Tests over every committed local, local-outbound-actions, remote-service,
Cloudflare, and Cloudflare All Aboard manifest confirm they all still refuse;
no target was promoted and the gate was not weakened.

Emitting the computed rows on a qualifying V8 target remains open follow-on
work under LLP 0216 G4. This resolution settles the vocabulary and its drift
guard only; it does not claim that enforcement or promotion work is complete.
