# Chat / SpacetimeDB calibration arm

This arm implements the frozen LLP 0102 realtime-chat prompt with
SpacetimeDB 2.7.0. It ran against a fresh standalone target on Apartment Air:

- database: `llp0102-chat-spacetimedb-w1`
- database identity:
  `c2004eb2f79972743b2d2188d5169fabbe879a6453dd3d11653ef3530bcdb4c8`
- isolated server port: `3312`
- isolated Vite port: `4291`

The server keeps source tables private and exposes caller-dependent views.
All writes go through reducers. The generated TypeScript bindings are checked
in beside both the React client and the evidence harness.

The acceptance run accounted for all 15 frozen checks: 13 PASS, 2 GAP, and
0 FAIL. Typing is a clearly labeled durable-row workaround rather than a
native ephemeral primitive. Cold-start offline history is unsupported.

The target and both assigned ports were cleaned. See `evidence/` for the
raw scenario, performance, actor-attribution, and cleanup receipts.
