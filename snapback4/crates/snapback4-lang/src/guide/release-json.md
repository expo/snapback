# Release inspection JSON

`releases <dir> --json` prints the same JSON object as plain `releases`.
These names use underscores; the active identity is `release`, not `current`.

| Field | Meaning |
| --- | --- |
| release, previous_active, latest | Active release, previous activation target, highest successfully adopted release; null when absent |
| generation, revision | Monotone execution generation and release-history revision |
| native_digest | Active native module digest, or null |
| events | Up to 16 activation/prune records: id, at (Unix ms), operation, release, previous, generation, revision, summary |
| events_after | Last returned event id, or null; pass as --after to get the next page |
| items | Up to 16 dormant storage items; with --event N, the retained items for that event |
| items_after | Last returned item key, or null; pass as --items-after for the next page |
| event | Requested event id, or null for the current dormant inventory |
| workers | Up to 16 [metadata key, status text] pairs; use doctor for handler health |
| selected | Present only with N/latest: {release, current (boolean), digest} for that immutable source |

Continue while a page is nonempty; a full final page may require one empty read.
The first stdout line of serve is its listening URL; stderr's SNAPBACK4_READY
confirms startup. The proof kit's startServe waits with timeoutMs and stops an
owned child on timeout (`guide testing`). Captured conventional server/worker
entries and named service workers start automatically. Resource files belong
under SNAPBACK_PROJECT_DIR, the immutable release root in serve. Packages stay
installed on the host; --worker is an explicit conventional-entry override.
