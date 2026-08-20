# Remove the fork read-view raw-SQL ingress

**Status:** Resolved
**Owner:** Snapback kernel
**Due:** 2026-09-19
**Related:** LLP 0284 §3.2, `fork-read-view-new`

`ForkReadView::new` publicly accepts `&rusqlite::Connection`. The constructor
immediately checks `is_readonly(DatabaseName::Main)` and never returns or stores
a writable handle, so this is ingress rather than a live privilege escalation.
It still makes raw SQL part of the kernel's dependent-visible API.

Close this ticket by moving the constructor behind a kernel-owned typed read
operation or making it crate-private, then remove the matching privilege-surface
allowlist row. The row expires on 2026-09-19.

## Resolution — 2026-08-19

The six callers were all in `snapback-services::instance_fork::service`; no
kernel or test caller remained. The public kernel `ForkReadView` and its raw
constructor were removed. The service now owns a private `ForkReadView` over
its already-private read-only connections, preserving the same pinned SQLite
transactions without exposing `rusqlite` through a dependent-visible API. A
follow-up audit restored the kernel floor reader's Tokio blocking assertion and
test-support snapshot hook through a typed path/version notification bridge;
the other four copied query bodies had no additional guard, hook,
instrumentation, or error mapping to restore.

The `fork-read-view-new` privilege-surface allowlist row was removed. The
scanner no longer reports that item; the complete
`node scripts/check-kernel-raw-sql-api.mjs` gate remains red only on the 127
pre-existing LLP 0283 F-1 findings recorded in
`issues/20260819-security-gates-expected-red-until-f1.md`.
