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

---

**Handoff 2026-08-01 (not started; the Rust authority half of 01 landed
first).** `src/api_envelope.rs` now provides everything the serving path
needs on the server side: `parse_and_validate` (bounded, canonicity-verified,
member-digest-checked), `verify_correspondence` (exact-equality against the
server-derived projection plus function-set agreement), `envelope_digest`
(the content address), and the committed schema.

What 02 still owes, in order:

1. **Decide the composition fork recorded on ticket 01** — codegen emits the
   canonical envelope (0062 §5 as written; needs a JS mirror of
   `PublicFunctionManifest` plus the CI anti-divergence gate §5 itself
   requires) versus the server composing it from its own projection at
   activation (divergence structurally impossible; changes §5's "server
   never reserializes" clause). Everything below assumes the ingestion
   shape either way; only the producer changes.
2. **Ingestion**: extend the v1-sessions provision intent (closed DTO, LLP
   0012 amendment) to carry the envelope as opaque canonical bytes; the
   server computes the digest over received bytes itself, runs
   `parse_and_validate` + `verify_correspondence`, and activates it
   atomically with the function-manifest swap (same transaction). Cover the
   half-update rules §5 pins: schema-only/function-only provisioning lands
   either a correspondence-checked envelope for the completed pair or the
   explicit envelope-absent generation.
3. **Routes** (LLP 0031 dated amendment, the idiom this program has used
   four times): `GET /app-api/current` as `PublicNoStore` (app id, current
   envelope SHA-256, artifact tuple, capability field, advisory engine
   range, and the typed envelope-absent marker — not a 404); `GET
   /app-api/envelope/<sha256>` as `PublicProjection`, 64-lowercase-hex
   grammar, identity content-coding only, `Content-Digest: sha-256=:…:`
   over the transmitted body, strong `ETag`, `Cache-Control: public,
   max-age=31536000, immutable` on a verified 200, `no-store` on the
   evicted-hash 404 and the absent marker. Residue #5's matrix
   (GET/HEAD/304/OPTIONS/error headers; never a GET-body digest on a
   bodyless response; `no-transform`) is the test bar.
4. **Engine ingestion**: discovery → content-addressed fetch through the
   landed `fetchPublicArtifact` (already credential-free, non-redirecting,
   identity-coded, ingress-bounded) → verify digest before use → cache keyed
   by (normalized origin, app id, envelope hash) with a last-known-good
   pointer, per-origin and global limits, atomic writes under an advisory
   lock. Offline, the cached envelope serves `--help`/`introspect`/`types`
   only.

Done-when stays as originally written: a packaged engine against a live
local target discovers, fetches, verifies, and calls through a served
envelope with zero local artifact files.
