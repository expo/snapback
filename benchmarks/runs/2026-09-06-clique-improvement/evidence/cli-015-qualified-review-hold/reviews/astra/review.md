CHANGES_REQUIRED

Independent source review of candidate `ff894d7cefbb2190c09e03ab6ed4f40414f4d034`: the nine-file DX delta `1936eadd → 0004ff7f`, plus four version files on `22427817`. Two selection defects require changes. Both are source counterexamples; neither was executed during this review.

**P2 — Bind execution to the selected name, not merely its discovery index.** [test.rs:800](/Users/ccheever/clique-improvement/reviews/cli-dx-015-r1/astra/snapback2/crates/snapback2/src/test.rs:800), with execution in [test.ts:115](/Users/ccheever/clique-improvement/reviews/cli-dx-015-r1/astra/snapback2/packages/snapback2/src/test.ts:115).

The new filter compares names during discovery, then passes only `--journey-index` to a fresh process. That process reloads the module without checking the expected name. A deterministic counterexample is:

```ts
import { journey } from "snapback2/test";
declare const process: { argv: string[] };

const names = process.argv.includes("--list")
  ? ["target", "other"]
  : ["other", "target"];

for (const name of names) {
  journey(name, () => {
    if (name === "target") throw new Error("selected failure");
  });
}
```

For `test --journey target`, discovery selects index zero, execution runs `other`, and the candidate accepts its passing receipt while recording `scope.journey: "target"`. The selected failure never executes. Baseline plain `test` visits both indices and records the failure. Reloading by index predates this change; the new filtering and scope claim introduce the incorrect focused result.

Pass and validate the expected name before executing the body, or select by exact name and duplicate occurrence within the execution process. Registration drift must fail visibly.

**P2 — Provide a literal-value path for journey names that resemble options.** [test.rs:54](/Users/ccheever/clique-improvement/reviews/cli-dx-015-r1/astra/snapback2/crates/snapback2/src/test.rs:54), interacting with [main.rs:51](/Users/ccheever/clique-improvement/reviews/cli-dx-015-r1/astra/snapback2/crates/snapback2/src/main.rs:51) and [verbs.rs:385](/Users/ccheever/clique-improvement/reviews/cli-dx-015-r1/astra/snapback2/crates/snapback2/src/verbs.rs:385).

`journey("--help", failingBody)` is a valid registration. However, `test --journey "--help" --json` returns help with exit zero before selection, compilation, or receipt creation. Other names beginning with `--` are rejected as missing option values, and `--journey=...` is unsupported. Quoting does not change these argument strings.

Existing full-suite execution can run these registrations; the new exact-name interface cannot select them and, for help spellings, reports successful command completion without testing. Add an escaped value spelling and make help detection respect option values.

The remaining source assessment is:

- React startup captures the owner’s actual `SNAPBACK_URL=…` line, strips the prefix, and quotes the Vite assignment. Canonical project paths are single-quoted with embedded apostrophes escaped. Detached-owner output goes to its log, and `&&` prevents Vite startup after installation or owner failure. Headless and Expo retain owner-only startup after dependency installation.
- The generic React app renders the provider’s shared connection snapshot. The provider initiates manifest requests; this supplies meaningful initial connection feedback. The packet does not establish continuous liveness detection after an otherwise idle owner stops.
- With stable registrations and ordinary names, selection is exact and visits every matching index across files. Invalid mode combinations are rejected, unknown names fail with available names, and receipt-producing compilation, startup, loading, and execution failures retain selection scope. Plain `test` keeps its existing full-suite path. The unchanged runner still performs embedded offline-derived checks for durable journey clients, so “skips derived checks” is broader wording than the implementation.
- Owner isolation, startup refusal preservation, process deadlines, cleanup guards, and authority/custody mechanisms remain unchanged. The new optional receipt field preserves deserialization of older receipts.
- Cargo workspace and lockfile versions, the npm package, and both platform dependency pins agree at `0.0.15`; native platform metadata derives its version from that package. Publisher semantics remain unchanged, including production qualification, immutable tarball handling, and full template `test --json` calls.

I performed local source and baseline reads, patch inspection, and one bounded Python calculation: checking 46 relevant candidate/baseline files against manifest SHA-256 values, comparing manifest entries, and summarizing retained receipt JSON. All 46 hashes matched; manifest differences matched the stated thirteen paths. I ran no product code, tests, builds, benchmarks, publisher, network operations, or other reviewers.

The retained evidence has these limits:

- `affected-fresh-mtime.log` records 52 passes: 13 guide, 15 init, and 24 test-verb tests. Earlier affected and isolated failures remain recorded. These passes do not establish the two counterexamples above.
- `full-tests.log` remains red: package tests report 513 passed and 5 failed; Rust reports 784 passed and 3 failed, with 4 skipped; compiler checks also report missing corpus files. The four owner/outbox failures have retained baseline reproductions. Later isolated passes do not convert the original full run into a pass.
- `measure-check.log` retains both budget failures: consumer verification at **32.97 s / 30 s**, and project check at **1.26 s / 1 s**.
- Focused measurements performed **one passing check in 2.314–2.424 s**. Full measurements performed **30 checks in 15.664–15.905 s**, with effects blocked because the build lacked an engine. This measures reduced coverage, not equal-work acceleration; these executions identify version `0.0.14`.
- The retained browser record shows configured requests reaching port `54107` and displaying `connected`; the unconfigured run reaches unavailable port `3210` and displays `reconnecting` with `E_NETWORK`. It does not cover quoted-path execution, attachment/error combinations, or ongoing shutdown detection.

This is source review, not production qualification or whole-product correctness evidence. It establishes no outcome for the separate Apartment qualifier or other active programs. The complete report is returned here because the assigned workspace is read-only.