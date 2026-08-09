# LLP 0204 S1 remainder: OpenAPI + agent-skill projections and the external-API guide page

- **Status:** Open
- **Date:** 2026-08-09
- **Systems:** external surfaces, guide, codegen
- **Related:** LLP 0204 D2/D9.2, the `api.external-exposure` capability row

S1 Landing 1 (4b401a9e8) shipped the exposure core: the `api` manifest block,
the `/api/v1/{query|mutation|action}/{name}` family, invocation-gate
enforcement, exposed-only disclosure of `/inspect` + envelope, `api.origins`
bearer CORS, and the pagination lint.

Remaining S1 deliverables (this ticket tracks them until landed):

1. **OpenAPI 3.1 projection** (D2): one operation per exposed function,
   schemas from the envelope's per-operation JSON Schemas, served alongside
   the envelope. No OpenAPI generation exists in the repo yet.
2. **Generated agent skill** (D9.2): digest-pinned SKILL.md bundle teaching
   discovery (envelope), authority acquisition (D8 ceremony), code mode;
   never embeds the full API (LLP 0203 P1); sibling of API.md / OpenAPI and
   lands with them. Precedent: packages/snapback-app-cli/digest.mjs
   (snapback.agent-digest.v1).
3. **API.md exposure extension**: scripts/generate-app-api-md.mjs currently
   renders the full envelope; it must consume the filtered exposed
   projection and add the token-acquisition walkthrough (the LLP 0201 M6
   grader is the acceptance).
4. **Guide page** for the external API surface (authoring the `api` block,
   exposure semantics, disclosure, CORS) + flipping the
   `api.external-exposure` capability row's GAP.

The LLP 0031 dated amendment registering the /api/v1 family and the
api.origins bearer-CORS statement lands with this ticket's creation.
