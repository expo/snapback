# Round-1 failure ledger

No failure is exempted as baseline merely because an isolated rerun passes.
All implementation, harness and intermediate-run failures below are **ours**;
intentional negative controls are labelled separately. There are **no baseline
or environmental exemptions**. The single full run ended with exactly
`== 1 failure(s) in 1087 s`, exit 1, naming the client phase.

## Unexpected test failures — ours

1. `guide.log`: `client::client_aliases_keep_typing_on_ephemeral` failed the
   130-line card cap (97 pass / one fail). The merged card already had 131
   physical lines; the initial qualifier grew it further. Shortened the row
   guidance to 130 lines, retaining LV's text and all examples, without raising
   the cap. Complete guide subsequently passes 98/98.
2. `affected.log`: `rule 1: sign-out during transport cannot publish private data`
   raised AbortError instead of the terminal denial.
3. `affected.log`: `rule 1: close during local cannot publish private data` — same.
4. `affected.log`: `rule 1: close during dispatch cannot publish private data` — same.
5. `affected.log`: `rule 1: close during transport cannot publish private data` — same.
6. `affected.log`: `rule 1: close during delivery cannot publish private data` — same.
7. `affected.log`: `rule 1: close during publication cannot publish private data` — same.
   The initial local checkpoint tested cancellation before the existing terminal
   boundary. Restored that precedence: session/store refusal wins, then attempt
   cancellation. All ten unchanged session-boundary cases pass in
   `regressions-final.log` and `affected-corrections.log`.
8. `affected.log`: `createApp keep=true: useQuery and usePage preserve owned
   inputs through 20 invalidations, loaded cursors and removal` saw an undefined
   browser snapshot during its loop. This intermediate run overlapped source
   edits/rebuilds served by Vite; there is no baseline exemption. The unchanged
   complete two-case browser file passes in `affected-corrections.log` with the
   source stable. Final broad/full results are reported separately.
   The initial affected total was **1,382/1,389**, all seven reds listed above.
9. `react-keys.log`: `useQuery and usePage keep canonical arguments across
   renders, preserving loaded pages` timed out because the new browser fixture
   omitted Vite's `react/jsx-dev-runtime` alias. Added the alias, without changing
   the 30-second browser timeout. `grok-final.log` had already passed this test
   despite the same dependency-scan diagnostic; `react-keys-final.log` passes
   cleanly. This was a fixture error, not an environmental exemption.

## Intentional controls and a corrected control — ours

- The first unknown-footprint counterfactual unexpectedly passed after about
  five seconds: a background probe refreshed the stranded observation. Fixed
  the test to freeze background timers and require the apply itself to queue
  evaluations. The original healthy result was not a valid regression proof;
  both corrected device controls fail as intended.
- `no-active-cancel.log`: nine intentional failures, the `closed active reads`
  test on each of online/wasm/process × keep=undefined/false/true. The ninth
  observation cannot make progress while eight ignored-abort replies are held.
- `no-attempt-expiry.log`: three intentional failures, the `expired active reads`
  test on online/wasm/process. Disabling the deadline strands the queued owner.
- `no-unknown-refresh.log`: two intentional failures, wasm/process
  `acquired unknown apply footprint withdraws and refreshes every owner`.
  No replacement evaluation is scheduled by the apply.
- `move-duplicate-to-tail.log`: `queued owners progress under continuing arrivals
  and repeated invalidation` fails: the waiting owner never starts (index -1)
  instead of occupying position 16.
- `grok-rollback-before.log`: nine intentional failures, `queued recovery cannot
  republish a withdrawn deadline after rollback` on online/wasm/process ×
  keep=undefined/false/true. Every actual snapshot was data instead of loading.
  All nine pass with the deadline floor, without an extra recovery request.
- `react-raw-keys.log`: restoring raw JSON keys makes the browser key-order test
  observe 5 requests, 3 loading renders and one retained page; the correct
  result is 3 requests, zero loading renders and two retained pages.

Controls now run in isolated SDK copies so they cannot change the package used
by concurrent qualification. Early controls used restored dist-only edits
before broad/full tests started; all copies/edits were restored or removed.

## Setup and read-only lookups — ours

A few orientation reads used nonexistent `online-reads.ts`, `online.ts`,
`guide/reads.md`, `scripts/client-tests.mjs` and transport/helper paths. Located
and read the actual files with `rg` (`client.ts`, `guide/reads.rs`, etc.). No
product change or test result was inferred from those failed lookups. The two
expected fetch/merge conflicts were resolved retaining both lanes' text.

## Single full suite — all eight failures are ours

The client stage reports 4,890 tests: 4,872 pass, eight fail, ten declared skips.
All other phases pass, including **79/79** client model tests. Exact summary:
`== 1 failure(s) in 1087 s`, followed by `client tests`.
The eight failures in `full-suite.log` are:

1. `ephemeral typing: five real-server trials beside a durable typing control`
   timed out waiting for ephemeral trial 1 to disappear. The new deadline floor
   also suppressed ordinary expiry retries when the response was already expired
   at the current server estimate. Moved the local floor check after normal
   expiry handling, and limited online suppression to a deadline made apparently
   future by rollback. Real expiry still recovers at its existing paced backoff;
   rollback cannot renew the withdrawn body. The complete ten-trial witness now
   passes, with its original 4,500 ms bound, in `full-failures-fixed.log`.
2. `expired server replies: recover, keep=undefined`
3. `expired server replies: recover, keep=false`
4. `expired server replies: recover, keep=true`
5. `expired server replies: close watch, keep=false`
6. `expired server replies: close client, keep=undefined`
7. `expired server replies: close client, keep=false`
8. `expired server replies: close client, keep=true`

The seven retry fixtures saw 30,000 ms where they expected the first 25 ms
expiry backoff: they intercepted every positive timer in the observation's
async context, including the new independent attempt deadline. Excluded that
named deadline alongside queue-turn timers. The exact 25/50/100/200/400/800/
1,000/1,000 ms sequence, single-request bound, no early retry, close behavior
and final count assertions are unchanged. The whole ten-case expired-response
file passes. Combined with the complete 50-case clock file and typing witness,
the final follow-up is **61/61**, covering every full-suite failure and all
nine rollback regressions. No second full invocation and no baseline or
environmental exemption.


## Final cancellation audit — ours, corrected

`cancel-backoff-before.log`: the added `expired server replies: close watch,
keep=true` case fails before the final fix: eleven requests instead of ten.
The cancelled local attempt was already waiting in its expiry backoff; its
`finally` block queued another retry after last-subscriber close. Retry intent
now respects the attempt's aborted signal, while an expired live attempt and a
new owner's dirty request can still rejoin the queue. The existing close test
now covers all three retention policies with the same delays and assertions.
The final close/backoff and cross-tier liveness run passes **26/26** in
`cancel-backoff-fixed.log`. No additional full-suite invocation.
