# Snapback 4: million-row IndexedDB acquisition stalls on Chromium 151

Status: Open
Date: 2026-09-28
Scope: Snapback 4 web persistence / scale qualification
Related: LLP 3000.028 §6

Lane OK's real Chromium/IndexedDB replay completes the full calibration store
(including the hub) and the 1k/100k-key synthetic stores. Four million-row
cases did not finish acquisition: public interaction summaries, full public
rows, full own rows and owner keys. This also occurs without the new
owner-key capability. JS persistence is unchanged by Lane OK. Attribution is
environmental/unresolved; this is not a proven owner-key regression or a
confirmed browser defect.

All four acknowledged at least one million staged rows. After extended waits,
the original page.evaluate remained pending. The summary browser was idle
(no CPU-time advance on browser/renderer) but responsive to independent page
and CDP requests. Its indexedDB.databases() request also remained pending.
The owner-cost Web Lock remained held. No completed replica or complete
absence proof is claimed. Runs were stopped after capturing elapsed time,
partial IndexedDB usage and process high-water RSS.

Evidence: [Lane OK report](../snapback4/reports/20260928-ok-owner-key-coverage/REPORT.md),
`browser-stall-*.json`, `browser-stall-processes.json`, `browser-million-*.log`
and `browser5.log`. Native million-key acquisition/adoption completes.

Reproduce after producing worktree-local native cost fixtures:

```sh
cd snapback4
OWNER_BROWSER_SIZE=1000000 OWNER_BROWSER_MODE=keys OWNER_BROWSER_VIEWER=prolific \
  OWNER_BROWSER_TIMEOUT_MS=1500000 OWNER_BROWSER_OUTPUT=browser-repro.json \
  node experiments/p19-one-query/owner-browser.mjs
```

Use a fresh output file to avoid reusing an earlier successful case. Compare
`public`/`summaries` controls. The harness now records staging/publication
progress and bounds the wait rather than leaving an indefinite run.

Next: isolate Chromium version/profile and the packed-bucket/overflow
transaction path, capture IDB completion/abort events, and test crash/reopen
before claiming million-row browser qualification. Keep rows and complete
markers atomic; never split publication or evict keys while retaining
complete owner coverage to make the benchmark appear successful.
