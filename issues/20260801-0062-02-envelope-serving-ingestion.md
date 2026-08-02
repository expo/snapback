# 0062-02: envelope serving and ingestion

**Status:** OPEN. **Authority:** LLP 0062 §1/§5, residue #5 (the
HEAD/`Content-Digest` matrix: GET/HEAD/304/OPTIONS/error headers, no
GET-body digest on bodyless responses, `no-transform`, identity
encoding); LLP 0031 (route-class registration — dated amendment
required); LLP 0012 (envelope DTO amendment, ENG-25405's doc half).

Serve the envelope on `/app-api/*` (app-data plane, PublicNoStore-
class posture per 0062 §5; content-addressed; precedence over asset
fallback recorded for the future hosted profile), and teach the engine
served ingestion: discovery, content-addressed fetch via the landed
`fetchPublicArtifact` path, verification before use, cached-envelope
offline surfaces (`--help`/`introspect`/`types` only).

Done when: a packaged engine against a live local target discovers,
fetches, verifies, and calls through a served envelope with zero local
artifact files; route-registry + digest-matrix tests green.
