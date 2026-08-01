# Asset client sends x-snapback-dev-user; server reads it nowhere

**Status:** OPEN — observed during the chunk-ceiling fix (2026-08-01)

`packages/snapback-client/assets.mjs:346` sends `x-snapback-dev-user` on
dev-lane asset requests, but no server code reads that header: dev-lane
HTTP caller identity actually resolves from body/anonymous. Either the
server should honor the header on the dev lane (making dev asset HTTP
requests carry real per-user authority — which would also shrink the
recorded dev-lane HTTP body-authority gap the conformance suite pins),
or the client should stop sending a dead header. Resolve together with
that recorded gap rather than piecemeal.

---

**RESOLVED 2026-08-01 (fix-wave α1): dead header removed.** No server
route ever read `x-snapback-dev-user`, and TUS PATCH raw bodies cannot
carry the dev body-authority shape, so honoring it means the recorded
dev-lane authority design — not a header hack. The client no longer
sends implied custody; per-user dev identity flows through host-ops
until that design lands (the conformance suite keeps the gap pinned).
