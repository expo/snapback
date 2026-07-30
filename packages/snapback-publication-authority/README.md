# Snapback publication authority

This private package is the standing authority required before
`scripts/snapback-promote.mjs` may mutate npm's `latest` tag. It is deliberately
separate from npm credentials and npm itself.

The service exposes four authenticated endpoints:

- `GET /v1/head`
- `POST /v1/leases/issue`
- `POST /v1/leases/acquire`
- `POST /v1/leases/close`

POST bodies are exact canonical JCS bytes and all authority shapes have closed
JSON Schemas under `schemas/`. `GET /healthz` returns only readiness and never
projects authority state. Leases and transition receipts are domain-separated
Ed25519-signed v2 envelopes. Heads are v3 challenge-response envelopes: every
authenticated head request supplies a fresh 256-bit challenge, and the
authority signs that challenge with the retained head state. Every envelope
binds one stable installation id, one canonical authority origin, and the
SHA-256 identity of the pinned Ed25519 public key; the publisher therefore
cannot substitute a different head or transition service or replay a head
response into a later observation.

The SQLite volume store uses `BEGIN IMMEDIATE`, `synchronous=FULL`, a monotone
generation predicate, and a digest over canonical retained state. One service
may restart safely on the same volume; multiple processes serialize through
SQLite instead of relying on a process-local mutex. Reopen revalidates every
retained lease and receipt signature, epoch/order, request digest, transition,
status, and generation. The service forces the volume directory to mode `0700`
and the database/WAL/shared-memory files to `0600`.

Generate an Ed25519 key pair outside the repository. Mount the private key and
Bearer token as secret files, and retain the public key separately for the
publisher:

```sh
docker build -t snapback-publication-authority \
  packages/snapback-publication-authority
docker run --read-only --tmpfs /tmp -p 127.0.0.1:8080:8080 \
  -v snapback-publication-authority:/data \
  -v /secure/private-key.pem:/run/secrets/private-key.pem:ro \
  -v /secure/bearer-token:/run/secrets/bearer-token:ro \
  -e SNAPBACK_PUBLICATION_AUTHORITY_PRIVATE_KEY_FILE=/run/secrets/private-key.pem \
  -e SNAPBACK_PUBLICATION_AUTHORITY_BEARER_TOKEN_FILE=/run/secrets/bearer-token \
  -e SNAPBACK_PUBLICATION_AUTHORITY_INSTALLATION_ID=snapback-publication-primary \
  -e SNAPBACK_PUBLICATION_AUTHORITY_ORIGIN=https://publication-authority.internal \
  snapback-publication-authority
```

Terminate TLS at the private service ingress. The lease-request client refuses
non-HTTPS authorities except explicit loopback test use. Bearer and signing
secrets are never accepted inline by the production service, in request bodies,
on CLI argv, or written to receipts. The service has bounded header, request,
body, keep-alive, and per-socket request limits. GET bodies plus
unauthenticated or oversized body refusals stop the readable side and close the
connection after the bounded error response rather than draining
attacker-controlled bytes. Authority clients also impose a response deadline
and a strict byte limit while streaming every response body, including error
responses, and cancel the stream when either bound is exceeded.

Loopback HTTP tests must opt in at both ends:
`SNAPBACK_PUBLICATION_AUTHORITY_ALLOW_LOOPBACK_HTTP=test-only` on the service
and `--allow-loopback-http` on the request client. Promotion remains
HTTPS-only.

Request a signed lease from a candidate ledger and a separately retained
official-registry `latest` vector:

```sh
(umask 077; security find-generic-password ... -w \
  > /secure/publication-authority-token)
SNAPBACK_PUBLICATION_LEASE_TOKEN_FILE=/secure/publication-authority-token \
node scripts/snapback-request-publication-lease.mjs \
  --ledger candidate-ledger.json \
  --prior-vector observed-prior-latest-vector.json \
  --authority-url https://publication-authority.internal \
  --publisher-instance publisher-host-01 \
  --operation-id release-0.1.1-20260728 \
  --public-key publication-authority-public-key.pem \
  --prior-closure-out prior-default-closure.json \
  --out authorized-publication-lease.json
```

Promotion uses that same exact origin, pinned public key, and token file:

```sh
SNAPBACK_PUBLISH_CONFIRM=yes-really \
SNAPBACK_PUBLICATION_LEASE_TOKEN_FILE=/secure/publication-authority-token \
node scripts/snapback-promote.mjs \
  --ledger candidate-ledger.json \
  --lease authorized-publication-lease.json \
  --public-key publication-authority-public-key.pem \
  --authority-url https://publication-authority.internal \
  --publisher-instance publisher-host-01 \
  --prior-closure prior-default-closure.json \
  --latest-proof-plan latest-proof-plan.json \
  --post-ledger post-promotion-ledger.json \
  --out promotion-receipt.json
```

The latest-proof plan is data for the package-owned
`scripts/snapback-github-latest-proof.mjs` helper, not a command runner. Its
closed v3 shape pins the GitHub repository, workflow, source ref and HEAD,
helper digest, operation id, committed ledger path, receipt paths, collection
path, bounded dispatch/verification timeouts, signed prior CLI version,
authorized lease digest, and publication epoch. Promotion refuses unknown
members, absolute or traversing paths, a dirty checkout, a mismatched helper
digest, or any substituted identity before acquiring the authority lease, then
reopens the frozen plan immediately before dispatch. After all tags converge,
promotion also requires a fresh-cache, scripts-disabled npm alias install to
resolve the candidate CLI and complete package closure. That publisher-region
barrier requires two complete candidate closures separated by 30 seconds and
preserves both probe bounds, the hosted-proof timeout, and rollback lease
reserve. Its v2 evidence retains that full policy, including the maximum
attempt ceiling. The release plan uses a 400-second dispatch bound: with
30-second verification, 120-second rollback, and the 120-second stability
window, 670 seconds of the 900-second lease remain reserved. It is still not
cross-host authority. Fresh-clock gates run after each retained success and
immediately before dispatch. The helper then dispatches the
pinned workflow; each
hosted platform uses distinct empty caches to retry only a structurally valid
signed-prior root under one package-owned wall bound before running the full
proof once. Receipts retain the closed retry policy and lease-bound attempt
witness. The helper reopens the run, workflow, and artifact inventory through
the GitHub API before accepting the two platform receipts.

Before requesting the signed lease, the request client uses a distinct empty
npm cache to bracket the download with two identical complete official
`latest` vectors. It retains every prior tarball and writes a closed receipt
binding candidate/operation/producer identity, timing, rollback actions,
tarball SHA-256/npm integrity/shasum, manifest digests, complete dependency
maps, and internal aliases. The v3 issue request and signed v3 lease bind that
receipt's canonical digest. The promoter recomputes the digest, enforces the
two-minute completion-to-issue freshness bound, rehashes and re-extracts every
tarball, and reopens the complete official vector before acquisition. Its first
mutation still reads a fresh complete vector and then makes a
challenge-bound acquired head the final observation. Moving this expensive
read-only proof before issue preserves the fixed 15-minute lease for mutation,
cross-host proof, and rollback without making a stale vector
mutation-authoritative. The service dual-reads retained v2 history but accepts
and emits only v3 issue/lease records.

The authority assigns `publicationEpoch`; callers can only present the
expected epoch and head they just observed. Exact issue replay returns the
retained signed lease; exact acquisition replay returns its signed receipt only
while the lease remains acquired; exact close replay returns its retained
terminal receipt while that record is still the durable head. Once a lease
closes, even an exact acquisition replay is refused. A changed replay, stale or
non-acquired signed head, wrong vector, expired lease, altered publication
ledger, origin/key/installation mismatch, or invalid signature is refused.
