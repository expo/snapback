# Serve and ingest the API envelope (/app-api routes, LLP 0012 + 0031 amendments)

**Status:** Open
**Severity:** P2
**Systems:** API, Server, Codegen, Docs
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0062 §5 (Review revision `14f54843…`), LLP 0012 (closed provision DTO; amendment vehicle), LLP 0031 (route registry; PublicNoStore), LLP 0037 (Rust DTO ownership)
**Marker:** app-cli, sub-stage-b, server

Sessions targets serve the envelope on the app-data plane beside
`/inspect`: `GET /app-api/current` (**PublicNoStore** discovery: app
id, current envelope hash, artifact tuple, `app-cli.target`
capability echo, advisory engine range; envelope-less generations
answer a stable typed marker) and `GET /app-api/envelope/<sha256>`
(64-lowercase-hex grammar; **PublicProjection**, immutable,
identity-encoded only, RFC 9530 `Content-Digest` + quoted strong
ETag; GET 200 = `public, max-age=31536000, immutable, no-transform`,
negatives = `no-store`; current+previous retention). The LLP 0031
registration pins the complete method/status header matrix: GET 200,
HEAD 200, conditional 304, OPTIONS, malformed/evicted errors, and the
envelope-less marker. `Content-Digest` covers actual message content,
so bodyless responses never inherit the GET-body digest; HEAD either
omits it or uses the empty-content digest and may use `Repr-Digest` for
the selected representation. The engine requests identity encoding
and refuses any unexpected content coding or transformation.
Discovery/envelope fetches are **bare, credential-free,
non-redirecting**. Ingestion per the final §5: the v1-sessions
provision intent carries the envelope as opaque canonical bytes;
admission **verifies JCS canonicity by reserialize-and-compare**,
bounds size, computes the hash server-side, requires the nested
function projection to be **exactly equal to the server-derived
`PublicFunctionManifest`** (publication is exact-match — additive
evolution goes through the Rust types; engine-side consumption stays
additive-ignore), checks every member against the codegen-emitted
**per-member digest map keyed by stable id** (operation schemas and
function-owned callable declarations) plus the schema artifact's
digest map for app-global declarations (together the independent trust
roots), validates
declaration members against the versioned grammar, and activates
atomically with the manifest swap. **Half-updates covered**:
schema-only/function-only provisioning activates a
correspondence-checked envelope for the completed pair or an
explicit envelope-absent generation; a stale envelope never survives
a replaced half. The v0-dev legacy form is not extended. Dated
LLP 0012 and LLP 0031 amendments carry all of it.

**Done when:**

- Both amendments landed; memory-server acceptance witnesses byte
  identity, digest/ETag recomputation, the GET/HEAD/304/OPTIONS/error
  matrix, conditional requests, identity-encoding refusal,
  `no-transform`, cache directives both directions including
  rollback-behind-a-cache, an intermediary transformation attempt, and
  the JCS cross-language conformance corpus (1e21 boundary, negative
  zero, long fractions) through both implementations.
- Activation-correspondence forgeries refused: manifest A + envelope
  B, swapped/missing schema or declaration with all envelope-local
  hashes recomputed, changed kind/authRequirement, zero-function and
  schema-only forged app-global declarations, noncanonical JSON, and
  unknown nested fields.
- Schema-only, function-only, rollback, restart, and
  legacy-provisioner transitions exercised; envelope-less sessions
  generations serve introspection only with the typed
  redeploy-required refusal on network operations.
- No credential of any class attaches to the public fetches
  (planted-carrier test).
