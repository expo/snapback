# LLP 0246 rollouts 3-5: multi-file .ts helpers, editor tsconfig, contextual types, dual-target corpus

**Opened:** 2026-08-12 (ordinary-TS authoring wave, run llp0245-0249-ordinary-ts-20260812)

LLP 0246 rollouts 1–2 landed (bounded-handler-typescript-v1 profile artifact,
pinned syntax erasure fixing the unerased-.ts-to-Hermes latent bug, lib-bearing
single-file type check, identity binding, `.mts` goldens, Hermes execution
test). The remaining accepted scope is stacked on work not yet on `main`:

- **Rollout 3** — `.ts`/`.mts` relative helper modules require LLP 0237's
  multi-file bounded-handler-modules custody, which is implemented in the
  concurrent local-mode run `llp0237-0243-authoring-wave-20260812` and not yet
  landed. Also the generated `.snapback/typescript/tsconfig.json` editor
  project (decide committed-vs-ignored against the LLP 0241 Metro-watch
  exclusion note before emitting).
- **Rollout 4** — generated contextual arg types + frozen-result assignability
  requires generic `define` builders or a per-app typed wrapper
  (`packages/snapback-codegen/define.d.ts` handler params are `any` today;
  LLP 0117 §F analysis).
- **Rollout 5** — the complete LLP 0237 adversarial graph corpus on emitted
  bytes for both targets, once 0237's corpus exists.
- **Rollout 6** — the published-package Clique/CRUD TS-only rerun.

LLP 0246 stays **Accepted** (not Implemented) until these land.
