# No route→schema join artifact; error envelope unversioned; root landing omits machine artifacts

**Status:** Open
**Opened:** 2026-08-08 · **Severity:** P1/P2 batch · **Area:** route registry / schemas / error envelope / server landing

From the 2026-08-08 agentic surface audit (LLP 0202 theme 8).

1. **No artifact joins an HTTP route to its request/response schema.**
   `schemas/query.input.schema.json`, `mutation.input.schema.json`,
   `connection.open.input.schema.json`, `live.subscribe.input.schema.json`,
   `ephemeral.publish.input.schema.json` etc. exist and are drift-gated
   (`src/schema_export.rs:1-16`), but nothing binds them to routes;
   `guide/surface-map.md` lists path + capability id only (no method, auth
   requirement, or body schema); no OpenAPI-like artifact exists. LLP 0194's
   generated reference deliberately scoped to the TypeScript surface. Fix:
   emit `schemas/http.routes.v1.json` from `route_registry()` carrying
   `(method, path, class, path_policy, credential_resolution, inputSchema,
   outputSchema)` and serve it beside the guide.
2. **The error envelope has no version field and no remediation member.**
   `schemas/error.response.schema.json` is `{diagnostic, receipt?,
   attribution?, ephemeralAuthorityInstance?}` with no
   `formatVersion`/forward-skew rule; `Diagnostic` has no remediation
   carrier (the carrier decision is the open author ruling in
   `issues/20260806-llp0146-oq6-remediation-carrier-decision.md`; the
   versioning half is untracked). Fix: add
   `formatVersion: "snapback.error-response.v1"` with a documented
   ignore-unknown-member rule alongside whatever OQ6 picks.
3. **App-data results over raw HTTP are unversioned; the module doc
   overclaims.** `src/app_data_result.rs:19` defines
   `snapback.app-data-result.v1` and claims HTTP carries it byte-identically,
   but the wire body for `POST /query/{name}` is `FunctionResponse`
   (`schemas/query.output.schema.json`) and `AppDataResultCoreV1` is never
   referenced in `src/server.rs` — it is a client-side normalization. Fix:
   emit the core from the invocation routes or correct the doc comment.
4. **The root landing under-serves discovery.** `GET /` content-negotiates
   four formats (`src/server.rs:16097-16111`) but its links
   (`LinksStatus`, `:16339-16345`) omit `/llms.txt`, `/app-api/current`
   (the credential-free machine-readable API envelope), and
   `/_snapback/api/control-catalog`. Fix: add three link fields.

## Resolution (2026-08-08)

All four fixes landed in the working tree. `src/schema_export.rs` now derives
the committed `schemas/http.routes.v1.json` route/schema join from
`route_registry()`, drift-checks every row and referenced schema, and
`src/server.rs` serves it at `/_snapback/guide/http.routes.v1.json` beside the
embedded guide. The Rust and Cloudflare error emitters now produce required
`formatVersion: "snapback.error-response.v1"`; the generated schema, Rust
decoder, and Swift consumer enforce the must-understand version while allowing
unknown top-level v1 members. LLP 0094 documents that forward-skew rule and
explicitly leaves LLP 0146 OQ6's remediation carrier undecided.
`src/app_data_result.rs` now describes client-side normalization without
claiming byte-identical HTTP transport. The root `LinksStatus` and its
JSON/YAML/Markdown projections now include `/llms.txt`, `/app-api/current`,
and `/_snapback/api/control-catalog`.
