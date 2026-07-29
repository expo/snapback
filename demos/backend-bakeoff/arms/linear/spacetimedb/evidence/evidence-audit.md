# Evidence audit

- All 14 frozen Linear scenario IDs are present exactly once.
- Result distribution: 11 `PASS`, 2 `GAP`, 1 `UNAVAILABLE_REMOTE_DEPENDENCY`, 0 `FAIL`.
- Full-text search and persistent offline/queue behavior are nonclaims with direct observations.
- Hosted Maincloud is an environment GAP; no local URL is labeled hosted.
- Actor identifiers are hashed in evidence; runtime tokens and identities were retained only under ignored `state/` and removed during cleanup.
- The exact seed and V1→V2 migration have independent count and schema receipts.
- Every frozen performance path has two warmups, seven raw samples, median, and nearest-rank p95.
- Cost scope distinguishes measured local provider charge ($0) from unavailable hosted list-price evidence.
- UI HTML, production build, and a rendered screenshot are retained without embedding a token.
- Cleanup is target-bound to one database identity, two validated processes/ports, and one exact state root; all post-cleanup probes are negative.
- A secret-shaped JWT scan over committed arm candidates passed.
- Failed attempts remain append-only under `evidence/failed-attempts/`.
- Client production build plus harness and server standalone no-emit TypeScript checks pass.
- `run-capsule.v1.json` passes the repository verifier.
