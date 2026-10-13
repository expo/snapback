# Integration 7 round 1 — codex

**Reviewer:** fresh Codex GPT-6.1 Sol
**Effort:** high
**Date:** 2026-10-13
**Reviewed source:** 016591ac229b0e790dfe4e565a60da84ad8de821
**Base:** 63b83fed6640739a215696879f2fef68fd7900fa
**Provenance:** fresh codex exec -m gpt-6.1-sol -c model_reasoning_effort=high --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox - < review-brief.txt. Mutually blind; no coding delegated. Response below verbatim. Raw invocation transcript retained compressed in the integration proof archive; sha256 963d120309ecdb57c96e94fd51427e95cf7b1f9c76d37d5c23f8b2483da96503.

---

NOT READY

Bound to **016591ac229b0e790dfe4e565a60da84ad8de821**, against base **63b83fed6640739a215696879f2fef68fd7900fa**, including all three merges against both parents.

Material findings:

1. **Client guide exceeds its unchanged budget.** The immutable [client.md](/home/ccheever/projects/snapback-sb4loop/snapback4/crates/snapback4-lang/src/guide/client.md:115) contains **115 lines**. Both [start.rs:32](/home/ccheever/projects/snapback-sb4loop/snapback4/crates/snapback4-lang/tests/guide/start.rs:32) and [client.rs:150](/home/ccheever/projects/snapback-sb4loop/snapback4/crates/snapback4-lang/tests/guide/client.rs:150) require at most **114**. The DX merge retained the offline-media link without recovering its line, deterministically breaking both checks.

2. **CLI regression expectations do not match the integrated diagnostics.** [check_notes.rs:55](/home/ccheever/projects/snapback-sb4loop/snapback4/crates/snapback4/tests/check_notes.rs:55) still expects two notes for two tables without writers. DX’s [readiness.rs:34](/home/ccheever/projects/snapback-sb4loop/snapback4/crates/snapback4/src/verbs/readiness.rs:34) adds two `N_NO_PRODUCTION_WRITER` notes, making four. Separately, both reaction snapshots omit PAGE’s `N_REFERENCE_UNCHECKED` notes for `membership` and `move`; [first_paste.rs:168](/home/ccheever/projects/snapback-sb4loop/snapback4/crates/snapback4/tests/check/first_paste.rs:168) requires exact snapshot equality.

3. **The delivery-await census omits the new witness module.** [witness-web.ts:27](/home/ccheever/projects/snapback-sb4loop/snapback4/packages/snapback4/src/witness-web.ts:27) introduces two awaits, but `delivery-await-boundary.json` remains unchanged and has no `witness-web.ts` entry. [awaitBoundary():254](/home/ccheever/projects/snapback-sb4loop/snapback4/packages/snapback4/test/delivery-fault-instrument.mjs:254) enumerates every source TypeScript file; [the equality assertion](/home/ccheever/projects/snapback-sb4loop/snapback4/packages/snapback4/test/delivery-fault-matrix.test.mjs:70) therefore fails. Classify these waits and reconcile the census.

4. **PAGE’s new serializer conflicts with the maintained wasm family fence.** [json_codec.rs:100](/home/ccheever/projects/snapback-sb4loop/snapback4/crates/snapback4-core/src/json_codec.rs:100) serializes through `ExactBuffer`, called for membership keys by [read.rs:1648](/home/ccheever/projects/snapback-sb4loop/snapback4/crates/snapback4-core/src/engine/read.rs:1648). [attribute-wasm.mjs:117](/home/ccheever/projects/snapback-sb4loop/snapback4/scripts/attribute-wasm.mjs:117) permits only the existing Vec writer and exact counting-writer exceptions. An in-memory probe of the immutable classifier rejected the `ExactBuffer` family for both `Value` and `ObjectFields`. Actual integrated wasm symbol retention remains for the integrator to verify.

No files changed and no Cargo/builds ran. Findings exclude concurrent uncommitted edits and prior verdicts. Publication’s full client suite remains unqualified; targeted reruns do not establish a green full suite.
