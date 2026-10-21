# Snapback 4: strace 6.8 can leave nested undecoded fragments in listener proofs

Status: Open
Date: 2026-10-21
Scope: Linux packed qualification; `scripts/proof-listener-audit.mjs`

An Integration 20 packed consumer attempt at da83e95c83 correctly refused a
strace 6.8 trace whose negative adapted-starter proof contained this record:

```text
926151 ???(926166 ???( <unfinished ...>
```

The strict decoder accepts bounded documented non-returning fragments only
with process-exit corroboration. This nested/interleaved shape was outside its
recognized grammar, so it raised E_PROOF_LISTENER. The frontend itself produced
the expected E_FRONTEND_SCENARIO refusal. No malformed trace was counted as a
passing listener proof, and the decoder/assertions were not relaxed.

For the complete final consumer qualification, Integration 20 built strace
6.17 from its upstream release tarball into an owned tools directory and put
it on that run's PATH. Every listener audit and the complete consumer run at
37a707c158 passed (receipt and raw logs in reports/integration20). Earlier
passing audits in that run used 6.8; later audits record 6.17 individually.
This is an environment repair, not evidence of a diagnosed upstream fix.

Investigate reliable 6.8 support or qualify a newer minimum tracer. Preserve
strict rejection of unknown/returned/unresolved listener records and the
owned-process exit checks. Do not accept arbitrary undecoded strings.

Evidence: `snapback4/reports/integration20/logs/earlier-strace68-refused.trace.gz`,
`packed-consumer.json`, and `logs/qualify-linux-integrated-main.log.gz`.
Upstream source: https://strace.io/files/6.17/strace-6.17.tar.xz.
