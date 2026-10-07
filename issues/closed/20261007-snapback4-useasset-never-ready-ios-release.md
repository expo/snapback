# Snapback 4: useAsset never became ready for an ordinary image in an iOS Release app

**Opened:** 2026-10-07, from the native Phase-2 rerun (LLP 0201.000, native.2)
**Status:** Resolved in Lane UA; round-3 review corrections verified on eb1000 (not yet published); operator iOS Release recheck pending
**Area:** `snapback4-expo` / `snapback4` asset hooks (`useAsset`) on iOS Release builds
**Related:** LLP 0201.000; the pilot packet on the Apartment mini, `~/clique-native-pilot2-20261006-round2`, which holds `results/snapback4/attempt-02/m6` and `attempt-03/m8`, plus `preparation/revision10/DIAGNOSIS.md`

## What happened

An independently built Snapback 4 0.4.13 Expo app passed both source audits and the semantic handoff. Its Release build installed and launched on the dedicated iOS 27 simulator, signed in, and rendered the direct conversation with its history. The ordinary-media message rendered its text, but **never its image**. The app declares `sm-convo-media` only when `useAsset` returns a ready handle, so the driver's M6 and M8 primes ended unmeasured with `selector-not-hittable`.

The evidence (P3 round-1 diagnosis):
- both fixture images match the descriptor SHA-256 and have the correct metadata (640×480);
- the message and asset references reached the native device store (read-only SQLite inspection);
- the observer recorded 120 screen events and 4 ready events, but **no media load or error events**;
- **the backend logs show no asset request,** and the app log shows no asset or download error.

So the hook apparently never issued a fetch, and never surfaced a refusal either. It could be:
- a Snapback 4 client bug on the native or Release path (scheduling, acquisition, the native asset URI or headers);
- an unmet precondition the hook waits on silently;
- the builder's wiring.

A silent wait with no request and no refusal looks like a product problem whichever of these it is. The hook should either fetch or say why it isn't.

## Next steps

1. Reproduce with a minimal Expo Release app on the simulator: a seeded ordinary image, rendered through `useAsset`.
2. Instrument the hook's state transitions.
3. Fix it, or add a diagnostic that names the blocking precondition.

## Resolution — 2026-10-07, Lane UA

A minimal generated Expo app using published 0.4.13 reproduces the missing
ordinary image in both Release and Debug on an owned iOS 27 simulator. The
web starter works. Instrumented hook and proxy traces correct the initial
no-request hypothesis: dispatch ran, the authenticated Range GET was correct,
and the server answered 206. Expo exposes a response stream, but React Native's
Blob constructor rejects the Uint8Array chunks assembled by the downloader.
The resulting local exception was misclassified as E_OFFLINE, producing retries
and reconnect churn. A ready-only view hides the hook error and never mounts
an Image, so no media callback follows.

The frozen pilot was read only and lacks hook-state/HTTP interception evidence;
its exact cause is not retrospectively established. The independent native
reproduction and a failing published-downloader control establish this repair.

The downloader now selects stream assembly by Blob buffer capability and uses
Expo's public Response.blob() on native, preserving size-aware timeout and
one-view rules. Every useAsset loading state names its current step and a
five-second diagnostic deadline; E_ASSET_WAIT explains still-pending work
without replaying it. Synchronous custom-reader exceptions become E_CLIENT.
Assets docs and diagnostic lookup explain the result. Generic native smoke
explicitly says assets were not exercised, and media witnesses must record
hook states and actual native load/error callbacks.

The fixed generated Release, Debug and web apps all reach ready and image-load.
An injected native 6.2-second pre-fetch hold exposes waiting.headers and
E_ASSET_WAIT before any asset GET, then completes with one GET and image-load.
Automated regressions exercise RN's production Blob implementation, held
session custody, late cleanup and no replay. No persisted format or native ABI
change. The owned simulator was shut down and deleted.

See the [UA report](../../snapback4/reports/20261007-ua-useasset-native/REPORT.md)
for traces, screenshots, exact qualification results, wasm measurements and
reproduction inputs. This issue's original observations remain above as the
investigation's starting evidence.

## Round-1 review corrections — 2026-10-07, eb1000

The public Expo blob path now distinguishes a rejected arrayBuffer read
(retryable transport) from conversion after a completed read (E_CLIENT, no
transport retry or offline transition). Regressions execute Expo's real
duplicate-module constructor fallback and an injected native conversion failure,
using the installed RN production Blob restriction. A local-client regression
checks one request and an unchanged online link for each conversion failure.

Asset wait deadlines now restart on a stage change or nonempty byte progress,
with received/total bytes exposed when known. Opaque transfers retain their
size-based allowance and cannot be called stalled after five seconds. Healthy
six-second HTTP transfers emit no E_ASSET_WAIT; genuinely held session/client
stages do. Loading literals remain source-compatible via optional waiting.
The no-uri cache fallback is documented as browser-only; Expo supplies uri.

All affected checks pass after correcting two new test message expectations;
the report retains the initial log and final reruns. The iOS fixture and recheck
steps now cover ordinary/slow success, a retention stall, and both conversion
failures. No simulator or other host was used in round 1; the operator's fresh
iOS Release recheck remains pending.

## Round-2 review corrections — 2026-10-07, eb1000

Conversion observation now uses a separate receiver, so sealed/frozen Expo
responses do not need an attached property. Skip the unused lazy stream getter
when native conversion owns the body. Real Expo/RN regressions cover success,
constructor fallback, native-store refusal and network reset on all three
response shapes, for ordinary and once. Local clients stay online after one
conversion-failing request even for sealed/frozen responses.

Streaming wait diagnostics now have a strictly earlier deadline (4,999 ms)
than the unchanged five-second abort, including first/restarted empty bodies.
Opaque headers/body waits explain unknown progress after fifteen seconds without
a stage change, independently of the full transport allowance. Other stages
retain five seconds. Fake-clock regressions observe each diagnostic before the
abort/retry, and the healthy six-second real HTTP cases still show no diagnostic.

Final requested checks pass: 247 affected client tests, 339 delivery-fault tests,
113 guide tests, client typecheck/build and docs/reference checks. The report
retains the initial frozen-getter failures and their green rerun. Operator
fixture modes now cover sealed/frozen failures and 16.2-second opaque waits.
No iOS run or push; the operator's Release recheck remains pending.

## Round-3 review correction — 2026-10-07, eb1000

The one-millisecond diagnostic lead ordered callbacks but did not guarantee
separate React commits. A busy thread could deliver notice and abort together,
then commit only backoff without the explanation. Backoff now retains the
preceding overdue stage's E_ASSET_WAIT in waiting.why and its complete stage,
progress and timing snapshot in waiting.interrupted. Capture uses the elapsed
clock even if the notice callback has not run. The next attempt clears the
snapshot; transport allowances and once-view safety are unchanged.

Three new regressions (empty first body, empty restarted body and partial body)
failed against round 2 with a committed DOM showing only loading. They pass
with the fix, in deadline order and abort-first order, with no React flush
between callbacks. Existing act-separated and opaque-expiry cases remain and
also assert that backoff retains the earlier explanation. The report records
requested suite results and current Release recheck steps. No simulator or
other host was used; the operator's iOS recheck remains pending. Nothing pushed.
