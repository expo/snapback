# Snapback 2

The from-scratch successor to Snapback: one language for queries and mutations
(bounded data programs, LLP 0329.014.004), one loop for the agent building on it
(LLP 0329.016), one binary. Seeded from spike S1 (`spikes/bounded-programs/`).

Start at [`AGENTS.md`](./AGENTS.md); the design root is
[`llp/1000-snapback2.explainer.md`](../llp/1000-snapback2.explainer.md); the
posture is [`rules/RULES.md`](../rules/RULES.md) and
[`rules/NOT-DOING.md`](../rules/NOT-DOING.md).

| | |
|---|---|
| `crates/snapback2-core` | IR, certificate, engine (SQLite), trace, client replay |
| `crates/snapback2-effects` | the effect seam; the only crate that may link Ibex 2 |
| `crates/snapback2` | the binary: `version`, `doctor`, `check` (more verbs per LLP 0329.016 §5.11) |
| `packages/compiler` | TypeScript subset → IR (spike S2) |
| `packages/evaluator` | the IR evaluator twin for clients (spike S3, 7.8 KB gzip) |
| `packages/snapback2` | the npm shim that resolves the platform binary |
| `corpus/` | 75 shared conformance cases |
| `scripts/` | `test.sh`, `measure.mjs`, `publish.mjs`, `hermes` |
| `metrics/loop.jsonl` | every measured run |
