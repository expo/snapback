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

---

**Ruling applied 2026-08-01 (composition fork step 1 of the handoff):
server-composes** (author ruling on record in LLP 0062 §5's dated note
and the Revised header). Consequences for the remaining steps: the
provision intent carries the CODEGEN-OWNED MEMBERS (operations map +
appBindings declaration + their member digests), not the whole envelope
as opaque bytes; the server composes the canonical document at
activation from its own projection + those members, JCS-canonicalizes,
digests, and self-verifies with parse_and_validate +
verify_member_digests + verify_correspondence — a failing composition
refuses activation. Steps 3 (routes) and 4 (engine ingestion) proceed
as written.

---

**PARTIALLY RESOLVED 2026-08-01 — the server half landed; engine
ingestion (step 4) remains.**

Landed under the server-composes ruling:
- **Composition (step 1 replaced by the ruling):**
  `api_envelope::compose_api_envelope` builds the canonical document from
  the server's own `PublicFunctionManifest` projection plus the
  codegen-owned members, binds those members to their carried digest map
  before composing, and self-verifies the result with the same
  `parse_and_validate` + `verify_member_digests` + `verify_correspondence`
  a received envelope faces. A composition that fails refuses activation
  before any durable effect (`SNAPBACK_APP_API_COMPOSITION_FAILED`).
- **Provisioning (step 2):** `EnsureAppExplicitInput::Provision` gained the
  optional `apiEnvelope` members carrier (`ApiEnvelopeMembersV1`, committed
  schema, drift-gated); absent members activate an explicitly
  envelope-less generation, reported as `apiEnvelope: "absent"` on the
  provision outcome (`"composed"` otherwise).
- **Persistence:** `_snapback_meta`-backed state with the current-plus-
  previous retention window LLP 0062 §5 pins, evicting anything older in
  the same transaction. Read is verify-on-read: a record whose inputsHash
  disagrees with the active generation degrades to the typed absent
  marker, so the crash window between activation cut and record can never
  serve a stale envelope.
- **Routes (step 3):** `GET /app-api/current` (`PublicNoStore`, sessions
  targets only — dev targets answer the typed refusal per §5) and
  `GET /app-api/envelope/{sha256}` (`PublicProjection`, 64-lowercase-hex
  grammar with a typed 400 otherwise, identity content-coding,
  `Content-Digest: sha-256=:…:` over the transmitted body, strong `ETag`,
  `public, max-age=31536000, immutable, no-transform` on a hit, typed 404
  on an evicted hash). Registry parity pin extended; diagnostics
  deliberately classified (400 malformed, 404 unknown/dev-absent, 500 for
  the two server-fault classes).

Evidence: `api_envelope` 13/13 (5 new composition tests: self-verifying
composition, determinism, member-binding refusal, ghost-operation
correspondence refusal, auth-mode tuple); `local::tests`
app_api_envelope_{composes_serves_and_rotates_across_redeploys,
composition_failure_refuses_activation,
absent_members_activate_without_an_envelope}; full lib suite 1617/0 after
rebasing over the upstream inputsHash fix; route_policy_v1 23/23,
artifact_schemas_v0 30/30, name_keying_guard 3/3, capability_v0 5/5,
host_ops_v0 2/2; app-cli + codegen package suites pass;
check-generated-artifacts ok; ref-check 147 docs / 0 errors; clippy clean.

**Remaining (step 4, engine ingestion):** discovery → content-addressed
fetch through `fetchPublicArtifact` → client-side verification before use
(the engine trusts its own verification, not the transport) → cache keyed
by (normalized origin, app id, envelope hash) with a last-known-good
pointer, per-origin and global limits, atomic writes under an advisory
lock; offline the cached envelope serves `--help`/`introspect`/`types`
only; absent-route degradation for older servers. The server surface it
consumes is now stable and testable.

The LLP 0012 DTO-amendment half of step 2 (registering the members
carrier in 0012's closed provision DTO documentation) is also still owed.
