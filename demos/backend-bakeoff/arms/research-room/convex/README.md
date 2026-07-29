# Research Room — Convex

This is the Convex-native LLP 0102 Research Room arm. It uses the pinned
`convex@1.42.3` package against a fresh anonymous local deployment.

The provider implementation is intentionally direct:

- Convex tables, ordinary indexes, a full-text search index, and a 32-dimension
  vector index are declared in `convex/schema.ts`.
- Queries, mutations, actions, scheduled functions, HTTP actions, native file
  storage, and authorization checks live in `convex/research.ts` and
  `convex/http.ts`.
- `harness.ts` drives Alice, Bob, and Mallory through Convex's native local
  development identities, including two independent native clients for
  WebSocket evidence.
- `src/` is the frozen neutral visual shell; it contains no target
  administrator credential or application secret.

The retained result is an untimed continuation after a Stop-class defect before
scenario work. The Convex local backend placed its generated control secret in
process argv and listened on wildcard addresses. The original target was
contained and destroyed; a rotated target reproduced the provider behavior.
Consequently `RESEARCH-13-SECRETS` fails even though the application canary
itself stayed server-side.

The hosted profile was not attempted because an isolated hosted credential was
not available. Nothing in this arm should be read as hosted deployment,
production-auth, cost, or operations evidence.

## Reproduction shape

Use the pinned Node dependencies, start a fresh anonymous Convex local
deployment, configure `RESEARCH_CANARY` through stdin, and run:

```sh
npm run build
npm run acceptance
npm run performance:build
```

The exact target lifecycle, failure record, security scan, cleanup receipt, and
machine-readable result are retained under `evidence/` and
`run-capsule.v1.json`. Never print the local backend's full process argv.
