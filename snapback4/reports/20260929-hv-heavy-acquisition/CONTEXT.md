# HV context

Scope: server cold snapshot production, shared device apply/publication, memory
row representation, browser strict persistence. Base aedd35615ad54901a481a01481e5d8f6110c69b4.
Read AQ round 0 and round 1 reports, contexts, failure ledgers, fixture note,
all four tools and current sync card. The lane's llp-orient symlink is empty;
applied the read-only skill from lane-sq/vendor/llp/skills/llp-orient/SKILL.md.
No Snapback 4 foundation entry; root, .007 and .019 are in current.

Governing constraints:
- LLP 3000#4: independent Snapback 4 workspace and checks.
- LLP 2000.000#7: declared authorized partition and one interpreter.
- LLP 3000.007#18.2: continuation, horizon, held/left history and atomic catch-up publication.
- LLP 3000.007#20.4: strict per-call durability, exclusive ownership, outbox custody and old-client format fencing.
- LLP 3000.002#proposed-device-representation-and-codec-redesign: complete durable batch before acknowledgement; failed saves discard the VM; conversion preserves left history and prediction bases.
- LLP 3000.008.004#3: real persistence-fault and reopen witnesses.
- LLP 3000.019#3.3 and #3.4: publication visibility and honest physical residency.
- LLP 3000.016#2.2: acquisition is independent of query coverage.

Risk: reducing retained representation must not alter query meters, provenance,
indexes or restoration. Chunked host transfer cannot split the strict transaction.
Format 3 must remain readable, including interrupted stages, outbox and bases.
The byte-bounded wire proposal in .002 remains Draft; no new transport protocol
is assumed. User explicitly commissions changes in the named core paths.

Likely docs: existing .007 persistence record, sync card, report and one journal
append. Hand-off: none. Private PF fixture copied with WAL to target/hv/store;
no writes to PF. No push or publication authorized.

Delivery-await audit (HV): web-idb.ts adds the format-4 save and migration
awaits; web-idb-pages.ts adds consistent read completion, directory loading and
strict transaction completion. These are persistence-host boundaries, already
reached through the matrix's caller save/open awaits. Their real IndexedDB
abort/current-predicate/commit/reopen behavior is exercised by web-pages and the
unchanged web-review/navigation/worker tests. No send, retry or settlement await
moves into a new helper. web.ts changes only the synchronous drain argument to
an existing awaited save; web-drain.ts has zero awaits. Refreshed only these four
entries in delivery-await-boundary.json; the census, fault recipes, required-site
set and delivery-fault-sites.json are unchanged. The suite caught this omitted
manifest refresh; the full result records the failure, and the focused matrix
recheck verifies the correction.
