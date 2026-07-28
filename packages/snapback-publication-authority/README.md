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
projects authority state.

The SQLite volume store uses `BEGIN IMMEDIATE`, `synchronous=FULL`, a monotone
generation predicate, and a digest over canonical retained state. One service
may restart safely on the same volume; multiple processes serialize through
SQLite instead of relying on a process-local mutex.

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
  snapback-publication-authority
```

Terminate TLS at the private service ingress. The lease-request client refuses
non-HTTPS authorities except explicit loopback test use. Bearer and signing
secrets are never accepted in request bodies or written to receipts.

Request a signed lease from a candidate ledger and a separately retained
official-registry `latest` vector:

```sh
SNAPBACK_PUBLICATION_LEASE_TOKEN="$(security find-generic-password ... -w)" \
node scripts/snapback-request-publication-lease.mjs \
  --ledger candidate-ledger.json \
  --prior-vector observed-prior-latest-vector.json \
  --authority-url https://publication-authority.internal \
  --publisher-instance publisher-host-01 \
  --operation-id release-0.1.1-20260728 \
  --public-key publication-authority-public-key.pem \
  --out authorized-publication-lease.json
```

The authority assigns `publicationEpoch`; callers can only present the
expected epoch and head they just observed. Exact issue/acquire/close replays
return the retained response. A changed replay, stale head, wrong vector,
expired lease, or altered publication ledger is refused.
