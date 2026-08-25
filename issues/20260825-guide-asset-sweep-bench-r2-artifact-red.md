# Guide asset-client sweep red: bench r2 harness log carries an unallowlisted raw-client accessor

**Opened:** 2026-08-25
**Signature:** `check-guide-asset-client-example.mjs` fails `asset client minimal example packed typecheck`:
`unallowlisted raw-client asset accessor in benchmarks/runs/2026-08-23-r2-published-0125/cells/opus-clique-explicit/events/harness.stdout.jsonl; use createAssetClient(client)`

**Attribution:** the artifact landed on main in `92f21bec4` (`bench(r2): record grok retained-capsule refusal`). The sweep (`checkRawClientAccessorSweep`) scans recorded benchmark harness stdout, so a *recorded model transcript* that happens to contain a raw accessor string reds the docs gate — the accessor is inside captured benchmark evidence, not in guide snippets or shipped code.

**Disposition options for the owner:** (a) allowlist recorded benchmark `events/*.jsonl` transcripts in the sweep — they are frozen evidence of what a model typed, not authoring guidance; (b) allowlist this run directory specifically; (c) redact the accessor in the artifact (worst: mutates frozen evidence). (a) looks right: the sweep's purpose is keeping *authored* examples on `createAssetClient`, and transcripts of models under test will legitimately contain the anti-pattern being measured.

**Status:** open. Inherited-red pin for landings under LLP 0232: docs/code landings unrelated to the sweep proceed; this signature is fix-forward work for the bench-r2 owner or the guide-check owner.
