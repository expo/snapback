# Lane FK — remaining suite flakes

Date: 2026-09-27. Host: expo-build-1000. Branch: `sb4-intent/fk-flakes`.
Base: `9473e0a34`. No push or publication.

## Findings and implementation

The identity failure was a **test race**. The first status poll could cancel
before the intended stall; the product promises no ordering between them.
The harness now forces status arrival first, then waits for actual stall
entry before delivering cancellation. Body cases signal entry at body
consumption, including cloned responses, rather than at fetch dispatch.
All cancellation, abort, no-mint/no-verification and late-effect assertions
remain.

The ephemeral investigation found a **product race**. A server-time estimate
100 ms ahead makes the expiry query return just before the server considers
the row expired. Publication correctly withholds that already-expired reply,
but previously discarded its deadline without scheduling another read. The
watch stayed loading with no further write, epoch change or deadline wakeup.
The same problem can occur when a reply crosses expiry in transit.

A rejected server/composed answer now marks a live observation for recovery.
The watch publishes loading, then retries through the ordinary query and
publication fences. It holds one request at a time, with 25/50/100/... ms
backoff capped at 1 s. A valid result resets the counter. Watch removal,
client closure or sign-out prevents the delayed continuation from issuing
another request. One-shot reads retain their existing loading result.

The original LX log lacks component timestamps. The controlled reproduction
establishes this product defect and reproduces the same timeout signature;
it does not establish LX's precise original clock offset or delivery order.

## Files

| File | Change |
| --- | --- |
| `packages/snapback4/test/identity.test.mjs` | Ordered cancellation fixture and actual body-entry proof, covering ten stall sites. |
| `packages/snapback4/src/local-query.ts` | Preserve a live-recovery indication when an expired server/composed answer is withheld. |
| `packages/snapback4/src/local.ts` | Pace recovery, serialize each watch's requests, and check lifecycle before continuing. |
| `packages/snapback4/src/local-reads.ts` | Per-watch bounded retry counter. |
| `packages/snapback4/test/ephemeral-e2e.test.mjs` | Force an early estimate, replay a real expired reply once even after a late scheduler wake, and record poll answers before delivery. Original appearance/disappearance, request-count and notification assertions remain. |
| `packages/snapback4/test/expired-server-watch.test.mjs` | Five recovery/teardown cases with real server replies and deterministic stale replay. |
| `packages/snapback4/test/prediction-routing.test.mjs` | Two cases for initial expired replies: a live watch retries; a one-shot read does not; neither remembers expired data. |
| `../llp/3000.017-ephemeral-tables.rfc.md` | Record expiry recovery and pacing in the existing client semantics. |
| `../issues/closed/20260926-snapback4-identity-invocation-stall-flaky.md` | Close the identity ticket with diagnosis and negative/positive proof. |
| `../issues/closed/20260927-snapback4-ephemeral-e2e-disappearance-flaky.md` | Open, investigate and close the ephemeral ticket with the product reproduction. |
| `JOURNAL.md` | One dated append with measurements and qualification. |
| `reports/20260927-fk-flakes/REPORT.md` | This review report. |

## Forms exercised

No syntax or public API was added. Existing forms still compile and run:

```js
const typing = client.observe(api.typingIn, { room: 'r' });
await client.mutate(api.setTyping, { room: 'r' });
// Once the row expires, typing recovers to an authoritative empty answer,
// even if an earlier expiry re-read returned a row the client must withhold.
```

```js
const kept = client.observe(api.typingIn, { room: 'r' }, { keep: true });
// Expired fallback replies stay withheld; the live observation recovers.
```

The existing identity invocation path still terminates with
`E_ACTION_CANCELLED` when status cancellation arrives during a provider fetch,
provider body, private-core fetch/body or mint fetch/body. The fixture's
`cancelOnStatus: entered.cancelOnStatus` waits for the selected stall, then
releases cancellation; resolving the stalled work later causes no identity
effect or late core request.

## Tests and proof

- Identity negative control: removing the entry wait and selecting the private
  core cases fails **5/5**, `false !== true` at the unchanged entry assertion.
- Identity fixed: **20/20**, five processes at a time with eight CPU workers
  sharing cores 0–7; ten scenarios per run, 200 scenarios total.
- Original ephemeral test: **5/5** instrumented loaded runs passed before
  fault injection. A delayed renewal reply alone also passed; this was not
  used as evidence of the diagnosed defect.
- Ephemeral negative control: fixed 100 ms early estimate with the original
  product fails **5/5**, `timed out: ephemeral trial 1 disappears`.
- Final ephemeral fixture with recovery disabled in an isolated copied
  package: **5/5 failures**, the same disappearance timeout. The fixture
  replays its last real row reply once at expiry, so a late scheduler wake
  cannot skip the race. No live suite or package bytes were mutated.
- Ephemeral fixed: **20/20**, five processes at a time on cores 0–7 with
  eight CPU workers, 259.976 s. All **100 trials** required an expired reply.
  First appearance: **4.867–47.664 ms**; authoritative disappearance:
  **3877.760–4041.328 ms** after the last call. Every trial sent **2** ephemeral
  requests versus **45** durable-control requests.
- `expired-server-watch.test.mjs`: **5/5**. Default and kept observations
  withhold all repeated expired replies, serialize requests, back off and
  recover to a complete/fresh empty reply. Closing a default watch, or either
  client's keep mode, stops retries beyond the maximum backoff interval.
- Routing and lifecycle tests together: **191/191**.
- Full identity and pre-existing routing tests: **202/202**.
- Affected expiry/keep/clock/ephemeral-watch tests: **72/72**.
- Whole guide: **86/86**. No guide card, Quarry snippet, diagnostic or note
  was changed; no new code belongs in `guide::CODES`.

Controls, the repeatable load driver, per-run logs and JSON summaries are
under `target/lane-fk-evidence/`. Both proofs used Node 24.13.1 and Bun 1.3.14;
all load workers were stopped using their owned process handles.

## Size, scope and decisions

`build-wasm.sh`: **1,980,253 B raw / 571,810 B gzip**, unchanged (delta 0 B),
against the unchanged **572,841 B** budget. SHA-256:
`324a54065e8d7077fe63e1d73dd26b24db29d8e8583d8a35753643f106c3fecc`.
The runtime change is TypeScript only. `local.ts` is 1,482 lines; all changed
source files stay below 1,500 lines.

The brief was silent on retry pacing: chose exponential 25 ms to 1 s to
recover short estimate/delivery races promptly without a tight request loop.
This is internal watch recovery, not a new retry API. Authorization,
disclosure, engine meters, durable admission and retention contracts are
unchanged. No timeout increase, assertion removal, new skip, version change,
budget increase or unrelated flaky-test fix. Supervisor owns integration and
the two blind reviews.

## Required full suite and open problems

Ran `scripts/test.sh` **exactly once**, exit **0**:

```text
== 0 failure(s) in 1403 s
```

No failures to classify as lane-owned, baseline or environmental; no other
intermittent failure appeared. Cargo stage: **3,809 passed, 24 existing
ignored**, 928 s. Main client batch: **2,488 passed, 10 existing skips**;
seven additional shards: **56/56**, client phase 197 s. Seeded models:
**78/78**, 260 s. Fixture wrappers: **9/9**. Native/wasm builds, docs/wasm
budgets, release guard, package build/typecheck and both app typechecks pass.
Both repaired cases and all five new expiry lifecycle cases passed within
this full run.

Used eight Cargo build jobs, dev/test debug information disabled and fd
limit 65,536, on Node 24.13.1 / Bun 1.3.14 / Rust 1.97.0. Logs:
`target/lane-fk-evidence/full-suite.log` and `full-suite.exit`. The suite
still exceeds the inherited 60 s budget; no gate, deadline or budget was
changed. Reproduce its complete qualification with `cd snapback4 && scripts/test.sh`.

No remaining known functional problem in this lane. The precise original LX
schedule remains unknown; the controlled reproduction and its limitations
are stated above. No unrelated flaky test was changed.

Implementation commits: `14b476903` (identity fixture), `0821cb053` (product
expiry recovery and regression coverage), `afeb7bad9` (force expiry coverage
even after a late scheduler wake). The final journal/report commit follows
qualification. All commits include the requested co-author trailer.
