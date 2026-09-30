# BN round 1 — completed reconnects and honest native receipts

Fixed the review findings in the acquisition witness. A receipt now requires a
validated, completed reconnect at the server's current position, successful
native publication, unchanged retained coverage, and zero downloaded events.
Every actual HTTP attempt is recorded, including failures and partial failed
runs. Reflected refusal text is discarded; supplied credentials are redacted
at output boundaries. Acquisition performance remains a known defect owned
by NA; this round does not optimize the device.

Read the original prompt/report and both complete reviews:
[Astra](astra-round0.md), [Grok](grok-round0.md). Merged `origin/main`
`28014164c6979995708e758c2090e53455101134` first in `81090e5a8a`, preserving
both commands, guide material and journal histories. NS retains LLP 3000.030
§13; BN is now §14 (`#acquire`), with both code references updated.
[Scoped context](CONTEXT.md). Nothing pushed or published.

## Review corrections

1. **Completed reconnect, not merely a returned promise.** Validate sync
   envelope types, record `more`, watermark, server position (`images_at`),
   store and generation, and require a final stream page with `more: false`
   and watermark equal to that position. Verify the local store reached it.
   Also observe successful native publication of that terminal page: a
   failed apply can leave the same old watermark, so equality alone is
   insufficient. HTTP, transport, JSON, protocol and native sync failures
   remain latched even when the SDK catches them. Failed requests and partial
   runs stay in `acquire.json`; no failed proof gets `retained: true`.
   Background change polling remains suppressed; deliberately blocked offline
   requests are not actual HTTP attempts.
2. **Credential boundaries.** Remote refusal text/code is never copied into
   diagnostics, so reflected transformations (including hashes) are discarded
   with it. Keep only the server's numeric timing grammar, excluding arbitrary
   header text. Redact the supplied token and common URI/JSON/base64/hex forms
   from string values and keys before serialization, and again at final text
   and thrown-error boundaries. This includes parse failures and artifact
   paths printed in text mode. A 401 remains `E_AUTH` with HTTP status, rather
   than being mislabeled unreachable. The echo test covers JSON stdout,
   text/stderr, receipt files, token-bearing principal/path input and malformed
   arguments. Tokens still pass as CLI arguments, as in round 0.
3. **Consistent witness CLI.** Acquire argument errors use `E_WITNESS_INPUT`,
   matching iOS. Bare `witness` advertises both acquisition and iOS smoke.
4. **Exact hosting description.** New receipts say Node sends one JSON line
   per call to the `snapback4 device` subprocess backed by SQLite. Expo links
   the crate in-process; these are not Expo/iOS timings. Web wasm/IndexedDB,
   application UI, physical phones and power loss remain separate evidence.
5. **Separate restart clocks.** `restart.firstLocalMs` stops at the complete
   local query. `restart.coverageVerifiedMs` starts afterward and includes the
   native coverage scan, residency and equality check. The summary prints
   `cold restart first local answer …; coverage verified (… table/groups) in …`.
   A deliberately delayed native scan tests ownership of the second timer.

The bounds guide and existing LLP record these rules. The merged witness card
stays within its unchanged 399-line budget. Original receipts and the round 0
report remain historical evidence; their notes and missing scan durations are
not retroactively rewritten.

## Known acquisition performance defect

The round 0 native heavy-account median was **42.081 s**, with about **2.55 s**
of Server-Timing and **39.5 s after headers**. Astra's independent fresh heavy
run measured **41.734 s**, of which **37.862 s was in native `apply` round
trips**, including a single **35.506 s** call. This localizes the dominant
cost to **process-device apply: JSON lines to the `snapback4 device` subprocess,
then SQLite**. It does not isolate a particular internal SQLite cause.

Grok compared roughly **16 s after headers** for HV's wasm client on the same
account and host class, with approximately 2.51 s producing server pages.
Native post-header cost per row worsened from about **0.07 ms at 11k rows**
to **0.37 ms at 105k**. This is a device application/IPC performance defect,
not the account's server cost or the harness's extra JSON decoding. NA owns
the follow-up. Successful offline retention does not establish fast native
acquisition, and Expo's in-process host was not measured here.

The historical 0.270 s cold-restart median is **time to the first local inbox
answer**, not time to verify 105,034 rows / 4,014 table/group pairs. Round 0
did the full coverage verification afterward but did not time it separately;
no duration for that old scan is inferred. Fresh round 1 receipts below carry
both clocks. HV's 18.609/19.522 s web acquisition medians remain historical
guidance, not promised native or phone latency.

## Fresh receipts

All **four fresh receipts pass** on the merged production binary and final
helper, after builds/tests finished. Both heavy receipts retain **1,000
conversation groups / 105,034 rows / 4,014 table/group pairs**; the smaller
account retains **100 conversations / 11,612 rows / 413 pairs**. Offline and
reconnected coverage digests match. Every reconnect ends with a validated,
natively published stream reply at server position **419402**, `more: false`,
and **zero downloaded rows/events**.

| CPU condition | Memberships | Acquisition, s | Restart first answer, s | Coverage verification, s | Server sync, s |
| --- | ---: | ---: | ---: | ---: | ---: |
| 96 CPUs | 100 | 2.484 | 0.040 | 0.022 | 1.567 |
| 96 CPUs | 1,000 | 43.208 | 0.239 | 0.289 | 3.526 |
| 10 CPUs + 8 burners | 100 | 1.385 | 0.052 | 0.023 | 0.469 |
| 10 CPUs + 8 burners | 1,000 | 41.350 | 0.252 | 0.285 | 2.651 |

These are **one sample per condition**, not new median/p95 or comparative
throughput claims. The loaded sample being faster does not establish a load
benefit. OS caches remain warm and the machine is shared; our builds/tests did
not overlap measurements. The original twelve receipts and three-run medians
remain unchanged. Recomputed receipt counts, clocks, native publication and
completion checks are in [measurements.json](measurements.json).

Receipts: [96 CPUs / 100](unconfined/u0500/acquire.json),
[96 CPUs / 1,000](unconfined/u0001/acquire.json),
[loaded / 100](ten-cpu-loaded/u0500/acquire.json),
[loaded / 1,000](ten-cpu-loaded/u0001/acquire.json).
Host affinity, burners and per-second load:
[unconfined host](unconfined/host.json), [loaded host](ten-cpu-loaded/host.json).
Exact binary, final helper and wasm identities: [artifacts.json](artifacts.json).

Reproduce after builds and tests finish, from the repository root:

```sh
node snapback4/reports/20260930-bn-envelope-proof/round1/measure.mjs
taskset -c 0-9 node snapback4/reports/20260930-bn-envelope-proof/round1/measure.mjs --loaded
```

The harness uses BN's private copy of HV's fixture and the same synthetic
login recipe; it never opens HV's source store for writing. Use fresh output
directories because the witness reserves each receipt exclusively.

## Validation and failures

- Final affected checks: **37/37** (27 witness and ten HTTP),
  [affected-final-native.log](affected-final-native.log).
- Whole guide: **107/107**, [guide-final.log](guide-final.log).
- **17 detecting controls on actual round 0**: 15 in
  [round0-controls.log](round0-controls.log), two additional native-payload
  cases in [round0-apply-controls.log](round0-apply-controls.log). Used the
  exact round 0 helper/guide and production binary SHA-256
  `d23ffa1822f57902d25283c20cf29d02216d4968eee6c3f99c449a9028b345a6`.
  Controls cover Astra's incomplete reconnect, HTTP-200 denial and malformed
  responses, dropped first request, truncated body, invalid types, an
  unfinished server position, malformed acknowledgements/acquisition markers,
  token reflection, CLI usage/diagnostics, hosting note, timing and defect prose.
  Seven reconnect variants expose round 0 false success: more-then-drop, HTTP-200
  denial, missing fields, bad `more`, behind-server position, bad acknowledgements
  and bad acquisitions. Invalid JSON, JSON null, dropped-first and truncated-body
  already exited nonzero in round 0; their new assertions detect missing failed-run
  evidence. They are not described as additional false-success reproductions.
  SDK source is unchanged between round 0 and the merged base.
- Reference check: **525 LLPs, 9,997 refs, zero errors or unchecked refs**.
- All failed development commands, expected controls and full-suite failures
  are classified in [FAILURES.md](FAILURES.md). Log trailing whitespace and
  surplus EOF blank lines are normalized; reported content and results are intact.

Ran `scripts/test.sh` once, with
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=8`.
Exact summary:

```text
== 1 failure(s) in 1265 s
```

Exit 1; 12 of 13 stages passed. Rust: **4,368 pass / 33 existing ignores**,
including 17 doctests. Clients: **5,336 pass / one failure / ten existing skips**,
with all 25 then-current witness cases passing. Fixture wrappers: **9/9**;
full-count models: **79/79**, including both 5,000-sequence walks. Zero
cancellations. Full log: [full-suite.log](full-suite.log); status:
[full-suite.exit](full-suite.exit).

The only failed case was `process: pending cut preserves presentTransition
before sync publication`, at the `notification starts sync` barrier in
`live-propagation-fallback.test.mjs:96`. Classification: **baseline**; the test,
helpers and SDK are unchanged from round 0 and merged main. The unchanged whole
file passes 10/10 on rerun; the focused case also passes 1/1 with the preserved
pre-round-1 debug binary. Root cause remains unresolved, so this is a
classification from unchanged scope and isolated checks, not a reproduced
causal explanation. [Follow-up ticket](../../../../issues/20260930-snapback4-live-propagation-notification-sync-intermittent.md).
Full-suite failures: **ours 0 / baseline 1 / environmental 0**. Passing reruns
do not erase the full run's red result. The native-apply guard and final safe 401
diagnostic were corrected during the build/Rust stages, before client tests
started. Source snapshots preserve this fact; this is not an unchanged-source
qualification. No Rust implementation changed during the run, and the final
witness/HTTP tests were separately rerun. After the full run, final inspection
found an introduced compatibility issue: `/native.wasm` is a binary download,
so the new transport must not parse it as JSON. The positive minimal-native-module
control failed against that implementation (`native-binary-before.log`), then
passed after preserving binary transfer and observing native installation.
A mismatched module digest also fails the proof. The final affected run is
37/37; these last two cases were added after the full run, and only the Node
helper/test changed then (`source-final.json`). The full suite was not repeated.
No assertion, test count or timeout
was weakened. The inherited nominal 60-second suite budget remains exceeded.

The suite rebuilt wasm at **1,978,828 B raw / 593,233 B gzip**, against the
unchanged **593,719 B** ratchet: **486 B** headroom. The wasm SHA-256 remains
`e0652576d56704990bf9cc8d745626de5219aa1c69d864623738888a77a93a50`, identical
to round 0. The native-only annotation and Node witness add no wasm bytes.

One journal entry and a local commit with
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>` record completion.
Nothing pushed or published.
