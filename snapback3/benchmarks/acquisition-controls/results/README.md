# Acquisition control artifacts

These files preserve the browser controls run on the EPYC host
`expose-builder-pixel` on 2026-09-12. The raw foreground results retain every
progress sample, storage timing, ordinary-SDK cursor audit, process receipt,
and physical-reopen observation. The summaries omit repeated per-page and
per-write arrays while retaining the values used for review.

`v4-storage-result.json` is the passing real IndexedDB result for package
`233237fccc3fb98fce48aab77c1c4beccba261a75952baf61299ea6383ec70fa`.
It binds storage source
`cf1869bbe3eae7c2afdd67d9d245fb35b192e3d2368c725dfcdb93b92b52f90a`,
SDK bundle `6070cc33032d0040a089a0383bf781d6bbddc80e1192ab05aa128fe9409430cb`,
and controller
`214b6208aa53e5539b7ac0fcb6befcf6cbc41bbb48a6e1f1b91a5d3549aad960`.
Its six checks cover v1 upgrade, atomic acquisition persistence and reopen,
authority/floor rejection with rollback, generation/session clearing, two
adapters sharing one database, and conditional session clearing. An earlier
launch failed before opening a server or browser because a symlink changed
`import.meta.url` provenance and cleanup awaited an absent server; it is not
presented as a product result. The passing rerun used a real source directory
and the corrected controller. This artifact remains scoped to that exact
storage implementation and does not qualify later client lifecycle changes.

`v7-storage-result.json` records nine passing real IndexedDB groups for package
`8cce9c949efe48e489ca638e7601d0d2ce250822357296f8abccfad2224e7489`.
It binds client source
`314d95a3d210eeda6e6055977fb0cc9c91d96a139f2c0cf6845c6772d82e44fb`,
storage source
`b53c8fabb5521a5ceb072d3f6c38b1bdd7dfedaab0f7c727f2a0764f23b6de20`,
types source
`d934bf6db72b46cfd8a4bd276bbed6229bd8074ef20334e22a5c86d61214e5a1`,
acquisition source
`5de8e5cdf29bb8f603813839a85bf8b13df6876e2d887d9d30facffbeaf01e56`,
SDK bundle `58b1e9a6ba1a13d186cac761a84781302ad4693540bbe550a0a64c6f42fd1169`,
and browser-control source
`6a3160cd78091849994009a390605c1040dbe4203c6620e41ec8550478996e3c`.
Three setup attempts preceded the passing attempt and are retained under the
private ship-run record. Attempt 1 copied a superseded source path and stopped
before Node launched. Attempt 2 could not resolve `playwright-core` in the
isolated copy and stopped during Node module loading. Attempt 3 emitted a
failed harness result because `/usr/bin/google-chrome` was absent; its checks
were empty and browser was null. None opened the control server or a browser.
Attempt 4 used the frozen source, its existing dependency installation, and
the installed Playwright Chrome executable, then passed all nine groups and
cleaned PID 2089428 at start tick 160614789. V8 subsequently changed the
storage implementation, so the v7 result is retained as a diagnostic.

`v8-storage-result.json`, `v8-foreground-result.json`, and
`v8-foreground-summary.json` are the final controls for package
`6eb3ca7780286a861d8e79e0f6e1322c37734036add5078011c6c05a72c44562`
and package-source digest
`70eb6314b7d61fa1527bf86c3ac3919f25cc2073a32ede5b15f55ab9084b2d9f`.
The storage result binds client source
`de9f1441744b2774d475ad47263ead06b0cf77789d16dcd783d89fd9d0940ad2`,
storage source
`f6c37ba1044464424ec49d1e5c0606a8d027c39605a1216aeee7dc3d8578700c`,
the same types and acquisition sources listed for v7, SDK bundle
`8ce8a9037a253cdbfd5344e6c7e9b92838f43ad7267781292bbe3167c9faf934`,
and the same browser-control source. All nine groups passed, including exact
checkpoint cancellation, current-session-token binding, successor
preservation, transaction rollback, v1 upgrade, and physical close/reopen.

All five v8 foreground scenarios passed. Sends triggered at 2, 98, and 132
of the original fixture's 151 pages, plus a lost-reply send at page 98. The
historical raw field name `fractionOfFinalPages` also uses that original
151-page denominator; successful post-send completion and audit contain 152
pages. Each intent became durable, settled with a committed receipt, appeared
exactly once to the independent recipient, and survived a physical
cached-shell reopen with browser networking disabled. Each offline audit
contained all original 10,000 rows plus the one accepted send at a common
sequence, preserving the original ID and canonical-row digests. The lost-reply
proxy consumed exactly one committed HTTP 200 response for the same original
intent; retry recovery still produced one recipient row and one server effect.
The interruption case closed on a durable 34-of-151-page prefix, resumed
through conditional validation and traversal, and passed the exact 10,000-row
physical-offline audit at one common sequence. The foreground controller removed
`SNAPBACK3_WORKER` from each owner child, recorded the packaged native worker
path/hash/PID/start tick, and verified all browsers, owners, proxy, and ports
were clean.

The v5 foreground result binds package
`21fa90a9dc13765cc8e0b9ddedacdd4221831be4fe6b60daf9678d2fa17cd47f`,
pack source
`15372c210573502f1bfd4a880164326ce7d3d6b8190663e5e84984e55bdfc5b9`,
and native worker
`8790d8a7a4b0c979921f05321ff0fb6b97beb0693509215f7bb6221a3e48a7e6`.
The v6 foreground result binds package
`fcc08d11c34a7619c4c62a31512b71138978bd862c5bf6fb8b4c64dc460b3d3b`,
pack source
`f2df8a3252437d9de36807d1c2444642441cb128f070c23b4078ac295108e25a`,
and the same native worker. Both used controller
`884f8860b78da12fdcd50bec6b04262538d917bc552b2fd6d49e4782f24460ee`,
which removed `SNAPBACK3_WORKER` from each owner child environment and recorded
the installed worker path, hash, PID, start tick, and cleanup.

All five foreground scenarios passed in both candidates: early, middle, and
late sends; a consumed-and-dropped committed send response recovered under the
same operation identity; and an interrupted durable prefix resumed after a
physical browser close. Every send had exactly one independently authenticated
recipient copy and survived a cached-shell browser reopen with browser
networking disabled. The ordinary public-SDK audits retained the exact original
10,000-row ID and canonical-row digests. The v6 prefix closed at 34 of 151
pages, resumed through conditional validation and traversal, and then passed
the exact 10,000-row offline audit.

The v5, v6, and v7 artifacts are historical diagnostics. Later review found
acquisition cancellation/declaration lifecycle defects, so none qualifies the
repaired v8 candidate. Browser profiles
and copied databases contain private runtime state and are intentionally
excluded. `hashes.sha256` binds every public file in this directory except the
hash manifest itself.
