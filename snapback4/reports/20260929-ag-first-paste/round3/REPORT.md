# Lane AG — first paste, round 3

Base: `5063318c988ba079e723a8885525742306e37f88` on
`sb4-intent/ag-first-paste`. Read rounds 0–2 prompts/reports and Astra's entire
round-2 NOT READY review. Earlier review findings remain fixed. This round
changes compiler advice, its tests and documentation; no interpreter, client,
authorization, disclosure, bounds or meter implementation changes.
No push or publication.

## Findings and conservative scope

**Finding 1 — fixed.** Branch advice is withheld for expiring targets, including
inherited expiry, and any optional result fields, including explicitly supplied
nulls. Incomplete, defaulted, engine-owned, private and non-plain result images
also receive no rewrite. Stable keys and values, unmixed keys and unchanged
unique keys remain required. The generated insert image must exactly supply
every required authored column. Scalar types admitted here are text, id,
principal, int, time, bool, enum and references; other types are conservatively
withheld rather than extending this proof.

Additionally, advice requires unconditional read authority from a direct
public/allow parent. An original upsert can update a hidden writable row and
return null; `exists` would select insert. The private Clique reaction fixture
therefore now keeps its original upsert. This is advice withholding, not a
change to which programs compile. Do not widen product authorization to obtain
a rewrite. Every withheld site explains the particular reason and says to keep
the upsert and observe queued/sent/failed state. No automatic `check --fix`.

**Finding 2 — fixed.** The new stable `principal: other` patch test withholds
advice. Disabling the addressed-key guard makes it fail, with no other guard
masking it (`mutant-key-change.log`). Existing effectful-key/value tests use
the public fixture so the new read-authority gate cannot mask their guards;
the row-valued-key test likewise has an otherwise eligible image.

The positive witness pastes the printed expression verbatim and compares the
original and rewrite's **returned value, every stored reaction row, and durable
effect names/payloads**, on first insert and subsequent update. It also asserts
one committed row, the expected changed emoji, two cumulative effects, and the
returned row in the emitted payload. Both worlds receive identical caller-minted
IDs. Cases: positional compound keys, reordered named compound keys, identical
key fields repeated in the patch, and a scalar id key. The id fixture has no
unaddressed alternate unique key. Both paths compile and execute.

Expiry witnesses use required and optional expiresAt at now: null result,
zero effects, no committed rows. Optional extra is materialized as null by the
original; both omitted and explicitly null images withhold advice. The hidden
writable-target witness updates one stored row, returns null and emits nothing.
Separate controls disable expiry, optional-image and read-authority guards;
each fails its corresponding test. The round-2 source fails the new withholding
regressions. All control mutations were restored.

The proof is about returned values, committed rows and downstream effects when
the mutation fits its meter. The branch adds read work and still needs held
coverage and runtime headroom; it does not promise identical meter charges,
identical refusal envelopes or prediction for every call. No meter ceiling is
changed. LLP 3000.007 §23 and the prediction card record the smaller surface.

## Verification

- Final affected tests (`affected-final.log`): **17 first-paste, 99 whole-guide,
  1 frozen compatibility and 41 residency-note tests passed**.
- Lowering comparisons (`affected-lang-guide-2.log`): **11 passed**; historical
  IR digests remain unchanged. This run preceded the final scalar-type/key
  restriction and hidden-row witness; the full suite also covers final source.
- CLI `why setReaction` prints the withholding reason and next step without
  branch advice or the old generic insert hint (`why-private.log`).
- Docs budget passed; README remains 300/300 physical lines.
- Ref-check passed: **523 LLP docs, 9,862 references, zero errors/unchecked**.
- No new test file, diagnostic code, registry or tracked generated artifact;
  no Snapback 1 inventory regeneration falls inside this fence.
- Every detecting control and development failure is listed in FAILURES.md,
  with attribution and resolution. The original full-suite invocation is kept
  intact and is not represented by a later targeted rerun.

Ran `scripts/test.sh` **exactly once**, exit **0**. Exact summary:

```text
== 0 failure(s) in 1387 s
```

Every stage passed. Rust: **274 binaries / 987 executions**. Client tests:
**4,561 passed / 10 declared skips / 0 failed** across eight processes.
Client models: **79 passed / 0 failed**. Full-suite failures: **ours 0,
baseline 0, environmental 0**. Expected authentication refusals in the model
log are negative-case observations, not failed tests. The inherited 60-second
suite target remains missed; no timeout, ceiling or test count was reduced.

Canonical wasm, built by this suite: **2,040,529 B raw / 592,975 B gzip**,
unchanged cap **593,719 B**, **744 B headroom**. SHA-256:
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
See `wasm.json`. No wasm runtime source changed.

The review hash is recorded in review.sha256. One append-only journal entry
accompanies the commit, with `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
No push or publication.

Captured log whitespace is normalized only at line ends and EOF; outcomes and
the exact script summary remain unchanged. Source/report whitespace checks pass.
