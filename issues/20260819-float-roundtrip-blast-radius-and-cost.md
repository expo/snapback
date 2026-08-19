# `float_roundtrip` blast radius: wire-value migration and unmeasured parse cost

**Status:** Open
**Filed:** 2026-08-19
**Systems:** Rust core, Wire contracts, Performance, Vector
**Related:** LLP 0132, LLP 0283 Method lesson 5, `68cf74907`

## Context

`68cf74907` enabled `serde_json/float_roundtrip` on `snapback-kernel` to make
decimal→binary64 conversion correctly rounded, as LLP 0132 requires. Cargo
unifies features, so this changes float parsing for every graph containing the
kernel — the shipped `snapback` binary and `cargo test --workspace` included.

Both reviewers agreed the change is correct and is the idiomatic fix. Neither
found a correctness defect. These are the two residual concerns they raised.

## Concern 1 — this is a wire-semantics migration, not only a vector fix

An independent codex `gpt-5.6-sol` review emulated both parser paths over all
3,947 tracked JSON files:

- 3,922 valid JSON files, 249,665 numeric tokens
- **600 tokens in 54 files change by one ULP** (505 demo, 92 acceptance, 2 archive, 1 target)
- **0 under `schemas/`, 0 under `tests/conformance/`, 0 embedded under `crates/`**

So the zero-`schemas/`-drift invariant holds and no pinned cross-language
profile moves — the vector witnesses in `schemas/vector.distance-profile-v1.json`
are strings, so payload and digest stay byte-identical.

But arbitrary application arguments enter as `serde_json::Value`
(`crates/snapback-types/src/manifest/types.rs:10705`) via routes such as
`crates/snapback-server/src/server.rs:26965`, and feed argument digests at
`crates/snapback-kernel/src/storage.rs:20355`. **The same long decimal sent
before and after an upgrade can therefore produce a different value and a
different argument digest.** No evidence was found of anything depending on the
old erroneous bits, and grok-4.6 independently confirmed the new behavior is
what LLP 0132, RFC 8785/JCS, and JS `JSON.parse` already required — the old
behavior was the deviation. Recording it so the digest change is a known
migration rather than a surprise.

A concrete non-vector example:
`tests/acceptance/fixtures/agent-safe-storage/performance-baseline.2026-08-03.v1.json:66`
— `7778.3330000000005` moves from `40be62553f7ced91` to the correct
`40be62553f7ced92`, and is used in arithmetic in
`crates/snapback-tools/src/bin/snapback-agent-safe-candidate.rs`.

## Concern 2 — parse cost is documented, global, and unmeasured

serde_json documents roughly **2× slower float conversion** with this feature.
`VectorRequestV1` accepts up to 4,096 `f64` components
(`crates/snapback-types/src/vector/types.rs:146`), so a float-heavy vector
request pays it per component. Handler bodies/results also parse JSON
(`crates/snapback-runtime/src/workerd_exec.rs:681`,
`crates/snapback-engine/src/runtime/host_glue.rs:5967`).

Whether this materially affects endpoint latency is **unmeasured** — database
and vector work may dominate. `68cf74907` carries no performance qualification.

## Acceptance

- A measurement of float-heavy JSON intake (a max-width `VectorRequestV1`, and a
  representative handler payload) before/after, recorded as evidence.
- If the cost is material on a hot path, scope the correctly-rounded conversion
  to the paths that need it (e.g. preserving vector number lexemes with
  `RawValue` or a route-specific raw-body parser) rather than reverting; a
  post-`Value` custom deserializer is too late and will not work.
- A decision recorded on whether the argument-digest change needs migration
  handling for in-flight/persisted digests.
