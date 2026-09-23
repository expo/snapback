# Exact staged web qualification: bounded navigation investigation

The original 0.2.33 attempt failed its final `page.goto` load wait after five passing stages (40.850 seconds total browser step). That failure is preserved; its cause remains unknown.

Two bounded fresh attempts then passed the exact unchanged witness, tarballs, binary, assertions and deadlines: an observer-only attempt in 11.450 seconds and an uninstrumented control in 10.567 seconds. Both installed with `npm ci` using the original failed attempt's exact lockfile. All six stages passed, including failed-update cache preservation, old-tab asset access, new worker activation and removal of the old cache.

The previous 0.2.32 and current failed 0.2.33 locks differ only in the two Snapback packages. `apps/chat` and both witness files are unchanged between their recorded source commits. Current runtime is Node24.18.0, Playwright1.55.1 and cached Chromium153.0.8010.12; the old run lacks a browser hash, so historical identity is not claimed.

The observer records navigation/request/response/load and worker lifecycle metadata, without headers or response bodies. On its successful final navigation, both the document and new hashed JS return200 from the service worker; DOMContentLoaded and load occur. The first failure has no corresponding trace, so these later observations do not establish its cause. Neither machine load nor a product defect is inferred.

No product edits, source/stage resets, repacks, publication or whole-suite reruns occurred. No unowned browser was killed. Both owned Node processes are gone; witness finally blocks closed their browsers/backends. The M5 slot was released immediately after the uninstrumented control. Root may use the successful exact-artifact qualification while retaining the first failure and its uncertainty in the release record.

See `summary.json` for identities, commands, PIDs, receipt hashes and remote artifact paths. Local attempt1/2/3 directories preserve the actual results and browser logs; attempt2 includes `navigation-events.jsonl`.
