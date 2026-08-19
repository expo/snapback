# Remove the fork read-view raw-SQL ingress

**Status:** Open
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
