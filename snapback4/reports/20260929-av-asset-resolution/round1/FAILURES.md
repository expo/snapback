# Diagnostic failures and attribution

This table includes unsuccessful development probes, not just the required full
suite. Counts include parent failures only where Node reports them; parents are
not separate causes. No assertion, timeout, wasm cap or model count was relaxed.

| Evidence | Failure | Classification / disposition |
| --- | --- | --- |
| Initial shell setup (tool transcript) | Several script launches used the repository cwd with a Snapback-4-relative output path; the first edit attempt also used a doubled snapback4 path. | Ours. Commands never started; corrected the working directory. No product conclusion. |
| `build.log` | Assigning readonly Refusal.message | Ours. Construct a new refusal value. |
| `faults-048.log`, `faults-main.log` | Probe started before avatars settled and retained cached media masked local failures; current-main process burst also read a revoked Blob URL. | Ours, invalid fixture controls. Disable retention, wait for initial readiness and reconnect each fault scenario. |
| `faults-main-v2.log` | Baseline dist copied after a failed TypeScript build had emitted some new files. | Ours, invalid baseline. Rebuilt all original HEAD sources independently into target/av-baseline-package; only v3 supports the main comparison. |
| `faults-fixed-first.log` | Process execution context destroyed during a pending probe | Ours. Rebuilding dist during Vite execution triggered a reload; final witnesses run against stable dist. |
| `affected-first.log` | One-view retry and public transfer jitter tests fired new deadline timers immediately under an all-timers mock | Ours, affected fixtures. Preserve real deadline timers; model the real one-view Range refusal. |
| `affected-first.log` | HTTP 404/410 refusal deep equality | Ours. Avoid adding retryable:false to unrelated terminal refusal objects. |
| `affected-first.log` | Web asset reset/unreachable/invalid rotation=false request counts | Ours, affected fixture. Its asset named “once” did not implement once's wire refusal; add E_ASSET_RANGE before non-range attempts. |
| `affected-first.log` | Web asset overload rotation=true expected four stale-credential attempts | Ours, intentional behavior change. One old-credential refusal now ends retries after rotation. |
| `affected-first.log`, `affected-v2.log` | `useViewer subscribes and useAsset has empty and failed outcomes` expected denied for E_CLIENT | Ours, changed API expectation. Assert explained error. |
| `affected-v2.log` | Process/wasm avatar reset probes used the original avatar id, already replaced by the preceding tier | Ours. Read each tier's current profile id. |
| `affected-v2.log` | Four ordinary “download delayed across store replacement” tests timed out at 40 s (native/wasm × preserve/drop) | Ours, affected fixtures. Their hold matched only 200; full-file downloads now return 206. Match successful asset responses, preserving every authorization assertion and timeout. |
| `affected-v2.log` | Native/wasm `list cache retires on expiry and stays retired after offline reopen` returned bytes after simulated expiry | Ours, product regression. Reconcile media before network backoff; otherwise a delayed clock sample can precede the first local expiry observation. Both unchanged assertions now pass. |

Completed affected reruns: all review/handle cases, all ordinary and once retry
cases, all asset-list lifecycle cases, the two expiry cases, full/partial ranged
retention and all three real-server avatar tiers pass. Required full-suite failures and exact counts are recorded in REPORT.md.

Full-suite discoveries (all ours):

- `ordinary media survives a process-device offline reopen; once never persists;
  home changes purge bytes` (250.839762 ms): its exact count expected three
  requests, but the three calls now make four: two ordinary transfers and the
  one-view Range refusal plus one non-range transfer. Updated that count with
  the explicit protocol reason; all offline, no-once-cache, revocation, expiry
  and LRU assertions remain. `seams-before-fix.log` reproduces 4 !== 3;
  `seams-fixed.log` passes.
- `every delivery await is explicitly classified` (148.435214 ms): the complete
  await fingerprint registry was stale. Reviewed the four changed entries:
  new asset-download queue/transfer awaits, assets.ts delegation, online
  client.asset's retry guard arguments, and local client.asset's pre-download
  media reconciliation/delegation. These are asset-call paths, unreachable from
  mutation delivery; the delivery helper census and all fault-site identities
  are exactly unchanged. Refreshed only `delivery-await-boundary.json`, with no
  coverage exemption or new recipe. `await-before-fix.log` records the delta;
  `await-fixed.log` passes both boundary and unchanged-census assertions.

The initial shell process-status diagnostic also failed parsing a process name
containing spaces; fixed the read-only diagnostic. It never affected a test.

Three more failures in the same full run exposed late-response disposal:

- `online assets revoke late credential-bound URLs across rotation, sign-out and
  close` (2.415751 ms).
- `in-flight assets and action are fenced without aborting effects on replacement`
  (8.711626 ms).
- `in-flight assets and action are fenced without aborting effects on regression`
  (7.338098 ms).

All are ours. The new abort path deliberately avoids allocating a URL, but its
late-response cleanup initially canceled only streams; buffered native responses
without a stream still need Blob disposal. Added that fallback and retained
one disposal owner when blob consumption has already started. Updated assertions
require zero newly allocated/revoked URLs after abort, exactly one Blob close,
and all original credential/store refusal and non-aborted-action invariants.
Credential rotation still revokes its one completed URL without retrying.
`cleanup-ownership-final.log` covers all 83 asset, Blob, session and terminal tests.
No complete-suite failure is assigned baseline or environmental status.
