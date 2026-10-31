# snapback4: web-start one-off failures under co-tenant load (two shapes)

**Opened:** 2026-10-31 · **Area:** `snapback4/packages/snapback4/test/web-start.test.mjs` · **Status:** closed 2026-10-31 (not reproduced)

During the LLP 3000.002.000.000 lanes on the apartment M5 mini, two one-off web-start failures occurred
while the host load was above 100 from other sessions' cargo builds and simulators; each passed on three
consecutive reruns with no runtime change between runs:

- Lane S2b: B4 "surviving capture fences first query and observe while another tab holds recovery lock"
  returned no `data` where `"after"` was asserted.
- Lane S3a: the lost-response/reload case's total query had no `data` (expected 4) after the recovered
  write was sent.

Both assertions now print the full returned read on failure. Related: the open
`20261030-snapback4-held-sync-two-owner-browser-read-intermittency.md`. Not reproduced on a quiet host.

**Next:** run `web-start.test.mjs` ten times on a quiet host at main `1b0a49003e` or later; if either
shape recurs, capture the printed read and diagnose against LLP 3000.002.000 §5.2 / 3000.002.000.000
§2.2 (publication at pending exit).

**Resolution (2026-10-31).** `web-start.test.mjs` ran ten consecutive times on the apartment-free local
host (load 9–30) at main `cf643b4583`: 10/10 files passed, 28/28 cases each, no cancellations. Both
observed shapes occurred only on the apartment mini with co-tenant load ≥100 (other sessions' cargo
builds and ~4,000 simulator processes) and each passed three reruns immediately afterwards, which
matches the known load-induced browser timeout class rather than a product defect. Closed as not
reproduced; the assertions still print the full returned read, so a recurrence will carry its own
evidence. Reopen with that read if either shape appears on a host under load < 20. The related
`20261030-snapback4-held-sync-two-owner-browser-read-intermittency.md` stays open on its own terms.
