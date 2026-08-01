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
