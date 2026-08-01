# Shared result core: Rust-owned semantic core, engine-owned wrapper (LLP 0024 amendment)

**Status:** Shelved
**Impact:** 4
**Urgency:** 2
**Ease:** 1
**Confidence:** 3
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “Shared result core: Rust-owned semantic core, engine-owned wrapper (LLP 0024 amendment)” shows the issue materially affects a supported product or engineering path; it can wait behind current correctness blockers, while delivery is a dependency-heavy, multi-stage program, with a clear design but unresolved dependencies.
**Severity:** P2
**Systems:** API, Client integration, MCP
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0062 §Position/§2 (Review revision `14f54843…`), LLP 0024 (canonical envelope; app-data MCP catalog), LLP 0019, LLP 0037 (ownership), LLP 0012 (diagnostic dialect)
**Marker:** app-cli, sub-stage-b, contracts

The final LLP 0062 pins the model exactly: the shared app-data result
is a **single Rust-owned serialized core DTO** — HTTP, headless
client, CLI, and the future MCP catalog carry its fields
byte-identically — and `appCliCallResult` is the engine's
**presentation wrapper** embedding the core verbatim plus
presentation-only fields (engine identity; active envelope identity,
absent on dev targets). This ticket lands the **dated LLP 0024
amendment**: the core DTO and its schema (Rust-generated per
LLP 0037, with the recorded rule that server delivery of the MCP
catalog keeps/flips ownership accordingly), the wrapper-to-core
mapping, the frozen per-kind mapping table (query rows / mutation
result+facts / action `ok:false` → exit 5 / one-shot live query),
registration of the `SNAPBACK_APP_CLI_*` family in LLP 0012's shared
dialect, diagnostic forward-skew rules (unknown server codes
accepted, preserved, marked unrecognized — never a third
compatibility gate), and the reserved tagged-value extension point.
The amendment document must land **before sub-stage (a) freezes the
result contract**; its server-side parity gates land with (b).

Forward skew also needs a frozen exit fallback, not only preservation:
for an unknown-but-syntactically-valid server code, the mapping table
classifies by wire locus and result kind while retaining the original
code. It covers ordinary non-2xx responses, HTTP-200 action/function
`ok:false`, live terminal frames, and caught/uncaught brokered errors;
none maps to exit 8 merely because the code is new.

**Done when:**

- The dated LLP 0024 amendment is landed with the core DTO schema,
  wrapper mapping, per-kind table, and ownership registration
  (LLP 0037 partition recorded there).
- Parity tests distinguish core parity (byte-identical across
  HTTP/headless/CLI, error paths and attribution included) from
  wrapper identity, for every function kind and principal class.
- Forward-skew tests: an unknown-but-valid server diagnostic code is
  preserved and marked, never rewritten, never exit 8; each of the four
  wire loci above asserts its frozen fallback exit class.
- The MCP-catalog parity obligation is stated in the amendment (the
  catalog itself does not block phase-1 completion).

## Shelved (2026-08-01, author decision)

Temporarily shelved per Charlie's 2026-08-01 decision on the
triage-sweep recommendation: the app-cli program is paused (owning RFC
LLP 0062 parked at Review since 2026-07-17; LLP 0122 Q6 still open on
the CLI's shape). Reopening condition: LLP 0062 leaves Review or the
program is recommissioned. The design content here is not invalidated
by the shelving.
