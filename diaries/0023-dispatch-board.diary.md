# 0023 — Dispatch Board trusted-values workout

## 2026-07-27 — atomic incident and audit writes

Dispatch Board writes an incident and audit record in one JavaScript mutation.
The handler freezes one `ctx.runtime.now()` value, mints distinct
`ctx.runtime.id()` values, and exposes live owner-scoped incident reads.

### What felt good

- Runtime time and IDs were straightforward and replay-safe. One timestamp
  intentionally appears on both records while the logical IDs remain distinct.
- Closed operation schemas correctly omitted every trusted field.
- One mutation committed both records atomically and ordinary live delivery
  observed the next report.

### What felt bad or surprising

- A generated operation schema was closed on the server, but the generated
  JavaScript reference did not reject an extra trusted field before transport.
  TypeScript catches this statically; plain JavaScript learned only from the
  server response.
- My first authenticated unsubscribe omitted `userId`. The resulting owner
  refusal was correct but easy to misread as a poll failure because it occurred
  at the end of the same acceptance check.

The fix projects each exact argument schema onto its generated function
reference and validates generated calls before network I/O with
`SNAPBACK_ARGUMENT_VALIDATION_FAILED`. Server validation remains authoritative.
The explicit unsubscribe identity stays visible in the test rather than being
inferred by the helper.
