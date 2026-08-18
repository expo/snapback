# LLP 0129 Phase 2a WASM assessment

Date: 2026-08-05  
Status: evidence-gate assessment; not a runtime or capability claim  
Scope: LLP 0129 Phase 2a browser ladder  
Decision owner: Charlie Cheever  
Evidence revision: `97e8ae9e9e6564877057a00e97a18f735fe79381`

## Recommendation

**Pin the browser story to the shipped JavaScript IR evaluator and defer WASM.**
Do not commission a full Hermes-to-WASM runtime for browser Parity. Reopen a
narrow, engine-free WASM handler slice only when a product-critical durable
mutation is proven outside the IR after bounded IR-extension review.

The load-bearing finding is not that arbitrary JavaScript is easy to move to
the browser. It is that Snapback's only frozen, named durable-mutation corpus
already classifies **12 of 13 mutations (92.3%) as expressible in the v1 IR**.
The shipping browser module is the complete v1 semantic executor. Only
all-aboard `applyLiveFeedSnapshot` genuinely needs general, data-dependent
control flow. Even that mutation is fed by a server-side action and is not
evidence that a common interactive browser path needs a local general runtime.

That 92.3% is a code-audited fact about the LLP 0051 frozen corpus, not a claim
about every handler subsequently added to `demos/`. The production local-
prediction wrapper is narrower still: on the frozen corpus, only **5 of 13**
are M1-shaped without an authoritative expression or an over-ceiling step;
seven more are semantically IR-expressible but are currently server-only,
effect-ceiling-refused, or still lack a generated local artifact. This
distinction is why the recommended replacement gate measures generated browser
execution, not syntax classification alone.

The bounded pure-Rust evaluator proof compiled to **306,890 bytes raw / 117,353
gzip / 95,830 Brotli**. The shipped JS evaluator's current browser bundle is
**21,295 minified / 7,615 gzip / 6,739 Brotli**. The Rust proof is therefore
15.4× the JS closure at gzip while excluding Hermes, Ibex, storage, host calls,
the mutation-step transaction executor, and the browser loader. A full runtime
has no in-repo artifact to measure. The planning estimate below is deliberately
broad: **5–15 MiB raw and 2–6 MiB gzip** for a pared Hermes/JSI/browser-host
closure, not an untrimmed Ibex port and not a measurement.

This document **meets Phase 2a's named evidence gate** by producing the dated
size/performance/feasibility assessment. It does **not** build a WASM runtime,
make a browser-WASM capability claim, or by itself resolve LLP 0129 open
question 9's author-owned choice between an assessment disposition and a
falsifiable implementation exit.

## 1. What “logic past the IR” means

### The relevant denominator

Phase 2a concerns local execution of durable mutations. Durable query results
already arrive through the read/materialization lane; actions remain
non-deterministic server work; and ephemeral handlers have no durable mutation
to replay. Accordingly:

- **Included:** the 13 durable mutations frozen as LLP 0051's measured demo
  corpus.
- **Excluded:** queries, actions/fetch/secrets, ephemeral publication, and
  handlers added after that corpus freeze. Those later handlers are sampled
  below, but there is no checked-in global classification fixture that would
  justify turning 12/13 into an all-repository percentage.
- **IR-expressible:** the closed v1 plan grammar can represent the semantics and
  `evaluateBrowserIrPlanV1` can execute the resulting data.
- **M1-shaped:** the narrower production local wrapper's
  `Insert`/`Get`/`Guard`/`Patch` effect ceiling can admit the plan without an
  authoritative-only expression. This does not imply that codegen currently
  emits an artifact for a JS-authored handler.
- **General runtime:** the semantics require data-dependent step skipping,
  general iteration, or another deliberately absent control-flow feature.
  Server authority or an external effect is a different reason to stay
  server-only; adding WASM does not make authority local.

### Frozen real-demo corpus

| # | Demo mutation | v1 semantic verdict | Current browser-local disposition | Evidence |
| ---: | --- | --- | --- | --- |
| 1 | todo-v2 `createTodo` | IR | server-only today: `AuthUserId` is authoritative-only for local admission | authored `Insert` at `demos/todo-v2/snapback/functions.mjs:61` |
| 2 | todo-v2 `setCompleted` | IR | M1-shaped `Patch` | `functions.mjs:76` |
| 3 | todo-v2 `editTitle` | IR | M1-shaped `Patch` | `functions.mjs:82` |
| 4 | todo-v2 `setPriority` | IR | M1-shaped `Patch` | `functions.mjs:88` |
| 5 | todo-v2 `deleteTodo` | IR | refused by M1 effect ceiling: full evaluator supports `Delete` | `functions.mjs:94` |
| 6 | graffiti `paintCell` | IR | server-only today: `AuthUserId` is authoritative-only for local admission | authored `Insert` at `demos/graffiti/snapback/functions.mjs:53` |
| 7 | todo `editTitle` | IR | M1-shaped and authored as a plan | `demos/todo/snapback/functions.mjs:62` |
| 8 | todo `setCompleted` | IR | M1-shaped lowering; current source remains JS | defensive `Get` then `Patch` at `demos/todo/snapback/handlers.mjs:27` is equivalent to no-op `Patch` + changed count |
| 9 | todo `deleteTodo` | IR | refused by M1 effect ceiling; current source remains JS | defensive `Get` then `Delete` at `handlers.mjs:35` |
| 10 | todo `createTodo` | IR | server-only today because the lowered `Guard`/`trim`/`Insert` uses `AuthUserId`; current source remains JS | `handlers.mjs:17` |
| 11 | all-aboard `resetFeed` | IR | refused by M1 ceiling: needs unrolled `Patch` plus `DeleteWhere` | `demos/all-aboard/snapback/handlers.mjs:579` |
| 12 | all-aboard `applyFeedTick` | IR | refused by M1 ceiling: bounded unroll plus `Get`, expressions, `Patch`, and `DeleteWhere` | `handlers.mjs:455`; LLP 0051 pins the equivalent lowering |
| 13 | all-aboard `applyLiveFeedSnapshot` | **general runtime** | JS/server-only | conditional per-pattern writes and data-dependent `touched` accumulation at `handlers.mjs:490`; declaration records `outgrewIr: 'conditional-writes'` |

Totals:

- v1 IR semantic reach: **12/13 = 92.3%**;
- genuinely general-control-flow: **1/13 = 7.7%**;
- M1-shaped without authoritative expressions or over-ceiling steps: **5/13
  = 38.5%**; this is a static shape count, not five proven generated artifacts;
- semantically IR but currently outside that production local ceiling: **7/13
  = 53.8%**.

The complete browser evaluator executes `Insert`, `Patch`, `Delete`, `Get`,
`Guard`, `Let`, `DeleteWhere`, and bounded `InsertEach` plus the closed value
expression library (`packages/snapback-client/ir-evaluator.mjs:377-460`). The
separate local classifier intentionally admits only `Insert`, `Get`, `Guard`,
and `Patch`, refuses the other semantically valid effects, and sends authority-
bearing expressions server-only (`ir-evaluator.mjs:36-54,572-635`). The
generated carrier validates source/schema identity and rejects non-local
capability classes before evaluation
(`packages/snapback-client/generated-mutation-ir.mjs:34-93`).

### Later-demo spot checks: why “past IR” is not synonymous with “needs WASM”

| Later sample | Classification | Consequence |
| --- | --- | --- |
| latency-kanban's six writes | authored IR: point inserts and guarded point patches | strong evidence that an interactive CRUD/reorder common path does not need WASM (`demos/latency-kanban/snapback/functions.mjs:44-92`) |
| contention-calendar `reserve` | authored/generated insert IR | the product-direction contention path already has one source carrier; its separate acceptance-only clear loop could lower to `DeleteWhere` but is outside M1 (`demos/zero-bakeoff/apps/contention-calendar/snapback/functions.mjs:43-74`) |
| team-chat `inviteMember` | outside current IR: filtered read, membership authority, conditional patch-or-insert | much of the blocker is server authority and filtered-read admission; WASM alone cannot make it a safe offline prediction (`demos/team-chat/snapback/handlers.mjs:58-89`) |
| party-wall `createPost` / `setCover` | server-only asset-attachment host effects | a general local runtime would still lack authority to attach a server-custodied upload (`demos/party-wall/snapback/handlers.mjs:32-45`) |
| all-aboard `refreshFeed` / `routeEstimate` | actions: fetch, secrets, timers/fallback | intentionally outside deterministic replay; browser WASM is irrelevant to authoritative egress (`demos/all-aboard/snapback/handlers.mjs:597-679`) |
| signal-desk write-with-activity | declarative plans with host-owned relation/source assertions and provenance | IR-carried but server-only by authority, not evidence for a JS engine or general client runtime (`demos/signal-desk/snapback/functions.mjs:244-361`) |

The practical browser ladder is therefore three-way, not binary:

1. IR-executable and locally admissible;
2. IR-carried but intentionally server-only because data, authority, or the
   commissioned effect ceiling is unavailable;
3. genuinely beyond the closed IR and a possible narrow-WASM candidate.

Only class 3 is evidence for WASM expressiveness work. The frozen corpus has
one such mutation, and it is not a common interactive offline path.

## 2. Size assessment

### Measured browser and bounded-PoC anchors

| Artifact | Raw/minified bytes | Gzip | Brotli | Measurement meaning |
| --- | ---: | ---: | ---: | --- |
| shipped `@expo/snapback-client/ir-evaluator` browser closure | 21,295 minified | 7,615 | 6,739 | committed esbuild browser/ESM/ES2022 metrology, including used contract dependencies |
| pure-Rust evaluator WASM PoC | 306,890 raw `.wasm` | 117,353 | 95,830 | exact `crates/snapback/src/value_expr.rs` + `crates/snapback/src/result_transform.rs`, minimal type/error shims, serde/SHA-256 closure; optimized for size with Rust LTO |
| Binaryen `wasm-opt` result | **not measured** | — | — | `wasm-opt` is not installed; no substitute number is mislabeled |

The measured Rust proof is **14.4× raw/minified, 15.4× gzip, and 14.2×
Brotli** versus the shipped JS closure. Those ratios compare useful payload
anchors, not equivalent implementations: the Rust proof includes result-
transform hashing but lacks the mutation-step transaction executor; the JS
closure includes the browser plan executor but no general runtime.

The JS figures come from
`tests/fixtures/client-bundle-metrology/current.v1.json`, profile
`public-subpath-ir-evaluator`, using esbuild 0.28.1, browser ESM/ES2022,
minification/tree shaking, gzip level 9, and Brotli quality 11. The Rust receipt
is
`tests/acceptance/fixtures/browser-lane/spike/rust-evaluator-wasm.2026-08-05/measurement.v1.json`.

Successful PoC command:

```sh
cargo +stable build --offline --manifest-path tests/acceptance/fixtures/browser-lane/spike/rust-evaluator-wasm.2026-08-05/Cargo.toml --target wasm32-unknown-unknown --release
```

Size commands:

```sh
stat -f 'rawBytes=%z' tests/acceptance/fixtures/browser-lane/spike/rust-evaluator-wasm.2026-08-05/target/wasm32-unknown-unknown/release/snapback_rust_evaluator_wasm_poc.wasm
gzip -9 -c tests/acceptance/fixtures/browser-lane/spike/rust-evaluator-wasm.2026-08-05/target/wasm32-unknown-unknown/release/snapback_rust_evaluator_wasm_poc.wasm | wc -c
brotli -q 11 -c tests/acceptance/fixtures/browser-lane/spike/rust-evaluator-wasm.2026-08-05/target/wasm32-unknown-unknown/release/snapback_rust_evaluator_wasm_poc.wasm | wc -c
shasum -a 256 tests/acceptance/fixtures/browser-lane/spike/rust-evaluator-wasm.2026-08-05/target/wasm32-unknown-unknown/release/snapback_rust_evaluator_wasm_poc.wasm
command -v wasm-opt
```

They produced `306890`, `117353`, `95830`, and SHA-256
`510ec4e67fb3d9d3aba161b5052f5447276850ce27ffcc2b16ab232c58969c9a`;
`command -v wasm-opt` produced no path. The first build attempt omitted
`--offline`, tried to refresh crates.io, and failed on restricted DNS. The
successful command above used the already-cached dependencies and is the one
bound into the receipt.

### Measured native Hermes anchors, not WASM payloads

The bootstrapped checkout provides real scale anchors:

| Local artifact | Raw bytes | Gzip bytes | What it is not |
| --- | ---: | ---: | --- |
| `vendor/ibex/ios/Frameworks/macos-static/libhermesvmlean_a.a` | 15,977,992 | 4,523,507 | not a linked WASM module; archive metadata and unused objects remain |
| `vendor/ibex/ios/Frameworks/macos-static/libjsi.a` | 271,984 | 70,278 | not the browser host or Rust glue |
| `vendor/ibex/tools/hermes/hermes` | 4,959,160 | 1,820,335 | a native executable for a different platform/feature/link configuration |

These numbers were measured with `stat -f '%z'` and `gzip -9 -c`; they cannot
be added or converted mechanically into a `.wasm` size. The available Ibex
`rlib` is a 492,743,744-byte debug artifact and is deliberately excluded from
payload estimation.

### Public feasibility evidence and full-runtime estimate

Public evidence proves possibility, not a Snapback payload:

- The official Hermes Static Hermes discussion says `shermes` can compile
  JavaScript to standalone or WASM output “with some effort”; it does not
  publish a supported browser-runtime product or size
  ([Hermes discussion #1137](https://github.com/facebook/hermes/discussions/1137)).
- A public `shermes-wasm` build recipe compiles the Hermes VM for WASI and
  links `hermesvmlean` plus JSI into a `.wasm`; the recipe publishes commands
  and a working execution transcript but no artifact size
  ([Static Hermes/WASI experiment](https://gist.github.com/guest271314/b10eac16be88350ffcd19387e22ad4d5)).
- A separate December 2025 experiment reports ~3.4 MiB native Static Hermes
  executables with roughly 3 MiB attributed to the runtime. That is a useful
  linked-runtime floor, but it is third-party, native, Static Hermes, and not
  full Ibex or a browser host
  ([Static Hermes + Effect experiment](https://gist.github.com/schickling/e53f0e65b772c0e62492c99afe3ae2cf)).

From those public results and the measured local archives, this assessment uses
a **5–15 MiB raw / 2–6 MiB gzip planning band** for an aggressively pared
Hermes/JSI/browser-host module. It assumes dead stripping and excludes Ibex's
server-only HTTP, TLS, filesystem, SQLite, module tooling, and CapSec data. An
untrimmed “compile Ibex as-is” artifact could be materially larger. The band is
an estimate, not a result; there is no full-runtime `.wasm`, link map, or
Binaryen receipt in the repository.

Against the measured 7,615-byte gzip JS evaluator, that estimated full-runtime
transfer is approximately **275–826× larger**. The honest conclusion is
“multi-MiB unless a real build disproves it,” not a point estimate.

## 3. Performance assessment

### Cold start

No Snapback handler WASM runtime exists, so this assessment reports **no
measured cold-start number**. A browser path would add fetch, validation,
baseline compilation, instantiation/import binding, linear-memory setup, and
possibly worker startup before the first handler result. The current JS IR
evaluator is ordinary bundled JavaScript and adds no second engine payload or
module-instantiation barrier.

Comparable public evidence establishes the direction and variability:

- V8 documents that its Liftoff baseline compiler produces code at “tens of
  megabytes per second,” then tiers hot functions in the background. Compile
  time scales with module bytes, so a multi-MiB runtime introduces a material
  cold compile stage even when streaming overlaps download
  ([V8 WebAssembly compilation pipeline](https://v8.dev/docs/wasm-compilation-pipeline)).
- Chrome can cache compiled code for sufficiently large modules fetched via
  the streaming APIs, reducing warm-start CPU, but cold load still downloads
  and compiles and cache validity is browser/version/resource dependent
  ([V8 WASM code caching](https://v8.dev/blog/wasm-code-caching)).
- The recommended web loading pattern is `instantiateStreaming`; it overlaps
  network and compilation but remains asynchronous and must be coordinated
  with worker readiness
  ([web.dev WASM performance patterns](https://web.dev/articles/webassembly-performance-patterns-for-web-apps)).
- As a historical comparable, the original cross-browser WebAssembly paper
  measured 18 ms V8 and 30 ms SpiderMonkey VM startup in its 2017 benchmark
  environment, and showed large warm-start gains from compiled-code caching.
  Those figures are neither current-browser numbers nor Hermes-module numbers
  and are not used as a Snapback prediction
  ([Bringing the Web Up to Speed with WebAssembly](https://people.mpi-sws.org/~rossberg/papers/Rossberg%2C%20Titzer%2C%20Haas%2C%20Schuff%2C%20Gohman%2C%20Wagner%2C%20Zakai%2C%20Bastien%2C%20Holman%20-%20Bringing%20the%20Web%20up%20to%20Speed%20with%20WebAssembly%20%5BCACM%5D.pdf)).

Inference: a small narrow handler module may instantiate acceptably, but a
5–15 MiB runtime makes first-use latency and transfer a product-level budget,
especially on mobile. Only a standards-real browser benchmark on named devices
can turn that inference into a number.

### Evaluation latency

WASM can be competitive with native code for compute-heavy kernels, but
Snapback mutations are small and storage/host-call-heavy. A general handler
host would repeatedly cross the WASM/JavaScript boundary for `ctx.db`, ledger,
auth projection, and serialization. A Hermes-in-WASM design adds another level:
JavaScript bytecode/execution inside Hermes, calling through C++/JSI/WASM
imports into the browser host. That is not the shape for which raw WASM compute
benchmarks predict wins.

The shipped IR evaluator instead walks JSON data in the page's existing JS
engine and emits one private write layer. For its intended CRUD/guard workload,
it avoids engine initialization and most cross-boundary marshalling. There is
no evidence that a full runtime would improve per-mutation latency, and the
most likely advantage—arbitrary control flow—is expressiveness, not speed.

Performance verdict: **unknown for a narrow WASM slice; structurally worse at
cold start and unproven at steady state for a full engine.** No measured eval
latency is claimed.

## 4. Feasibility verdict

### Repository reality on 2026-08-05

- `FunctionRuntime` contains only `HostPlan` and `IbexModule`
  (`crates/snapback/src/manifest.rs:6757-6760`); D3's proposed `WasmModule` variant is absent.
- The repository declares no Snapback handler `wasm32` build target, handler
  artifact pipeline, browser host/import ABI, or WASM conformance runner. The
  developer toolchain happened to have `wasm32-unknown-unknown` installed,
  which enabled the bounded PoC; that is not a repository toolchain.
- No wasmtime or WAMR handler host exists. Ibex's `wasmi` dependency is a
  pure-Rust host for a pinned lexer detector, not `FunctionRuntime::WasmModule`.
- Hermes remains server-side through vendored Ibex. A full port must first
  separate browser-appropriate engine/glue from Ibex's server powers.
- The browser store already ships IndexedDB + Web Locks and a v3 single
  transaction domain (`packages/snapback-client/rqs-store-default.mjs:111-119`;
  LLP 0166 D1). LLP 0008 DK-9 permits SQLite/wa-sqlite behind the seam but
  mandates neither. **wa-sqlite is absent and unnecessary to decide the WASM
  execution lane.**

### Product constraint

LLP 0051 §Rejected forbids QuickJS or any JS engine on clients for Parity. A
full Hermes-to-WASM interpreter is exactly a JS engine shipped to the browser;
changing its container to WASM does not evade that decision. It would require
an explicit author-owned reversal before implementation, and would reintroduce
the engine/version/divergence and payload class the IR tier was chosen to
avoid.

D3's engine-free form remains coherent: first-party Rust or another language
compiles a particular handler to a strict WASM profile, importing only the ctx
host-call op set. That path is technically viable in principle. It is not
cheaply available today because the toolchain must first deliver:

1. a versioned `wasm32` handler SDK/compiler profile and canonical ABI;
2. `FunctionRuntime::WasmModule` plus content-addressed artifact storage and
   public redaction/schema changes;
3. local-server and browser executors for the same bytes;
4. a browser loader/cache/worker strategy and CSP/MIME/error handling;
5. exact ctx imports, canonical value serialization, ledger/auth projection,
   traps, fuel/memory/stack bounds, and async suspension rules;
6. D5 corpus execution on both hosts, packaging metrology, and standards-real
   browser acceptance.

### Verdict among the three choices

> **Author disposition (2026-08-06, Charlie Cheever): option (i) adopted —
> browser story is IR-only, WASM deferred.** Phase 2a's governing falsifiable
> exit is exit option 2 below (the browser-IR-coverage gate); the reopen
> trigger recorded here is the standing path back to option (iii). Recorded in
> LLP 0129 §Open questions 9.

- **(i) Browser = IR evaluator only; WASM deferred/rejected — recommend now.**
  It covers 92.3% of the frozen semantic corpus, every examined CRUD/reorder
  common path is IR-shaped, and it costs 7.6 KiB gzip. Keep the one frozen
  negative server-only.
- **(ii) WASM as a commissioned full toolchain program — do not commission.**
  Full Hermes conflicts with LLP 0051, while an engine-free general handler
  SDK is a substantial multi-host program unsupported by demonstrated demand.
- **(iii) Narrow WASM for specifically proven IR-negative handlers — retain as
  the reopen path, not current work.** Commission it only after a named,
  product-critical offline mutation fails the IR plus bounded extension review.
  Its artifact must contain handler logic, not a JS engine.

Recommended reopen trigger: in a versioned reference-app durable-mutation
corpus, either (a) IR semantic coverage falls below 90%, or (b) one designated
common-path offline mutation remains inexpressible after two preregistered,
bounded IR-extension attempts. Authority-only and external-effect handlers do
not fire the trigger because WASM cannot make their inputs authoritative.

## 5. Falsifiable Phase 2a exit options

The author can replace the current non-falsifiable gate with one of these.
Paths and suites named below are proposed artifacts; they do not exist yet.

### Option A — assessment disposition (recommended for Phase 2a itself)

**Measures:** whether the assessment was completed and the browser direction
was explicitly decided, treating Phase 2a as research rather than an
implementation phase.

**Test:** a corpus check validates that the dated artifact contains (1) a
versioned handler denominator, (2) measured JS and bounded-PoC receipts, (3)
separately labeled estimates, (4) performance nonclaims, (5) one of the three
dispositions, and (6) a numeric reopen trigger. LLP 0129 must contain an
author-dated disposition pointing to the artifact.

**Pass:** all six fields validate and the author records exactly one
disposition. On this evidence the recommended disposition is IR-only with the
90%/named-common-path trigger above. This artifact satisfies fields 1–6 except
the author-owned disposition.

### Option B — browser handler-coverage gate

**Measures:** actual end-to-end browser reach of the IR lane, not merely
whether source looks lowerable.

**Test:** freeze every durable mutation in the chosen reference-app set in
`tests/acceptance/fixtures/browser-lane/handler-coverage.v1.json`; generate its
real function artifacts; execute locally admitted operations through the
shipping evaluator, settlement/rebase, React publication, and standards-real
IndexedDB browser carrier; run the D5 corpus on Rust and browser evaluators.
Proposed runner: `tests/acceptance/browser-handler-coverage-v1.mjs`.

**Pass:** (1) at least **90%** of the frozen corpus is semantically IR-
expressible; (2) **100% of mutations designated browser common-path** carry a
generated local artifact and complete the real-browser suite; (3) D5 is exact
on both evaluators; and (4) every remainder is explicitly `server-only` or
`offline-nonclaim`, with no common-path remainder requiring a general runtime.

### Option C — narrow engine-free WASM gate

**Measures:** whether real IR-negative demand can be served without shipping a
JS engine or creating an uneconomic payload/cold-start class.

**Test:** preregister one product-critical IR-negative mutation (the frozen
`applyLiveFeedSnapshot` is the only current negative but is not automatically
product-critical), compile it from Rust to the strict D3 profile, and run the
same content-addressed bytes through local and standards-real browser hosts.
Proposed runner: `tests/acceptance/browser-wasm-slice-v1.mjs`, with a fixed
desktop Chrome and one named mobile browser/device in the receipt.

**Pass:** (1) zero embedded JS engine; (2) exact D5 outputs/rejections and
settlement identity on both hosts; (3) gzip payload **≤256 KiB** including its
browser host increment; (4) cold instantiate + first result p95 **≤100 ms on
the named desktop and ≤250 ms on the named mobile device**, excluding network
but reporting transfer separately; (5) warm handler p95 no worse than **2×**
the JS IR evaluator on paired storage-equivalent cases; and (6) memory/fuel/
trap ceilings pass their negative corpus. Budgets are proposed bars for author
ratification, not results.

If the author instead wants a full Hermes runtime gate, LLP 0051 must first be
amended. A runtime experiment conducted before that policy decision would test
an inadmissible option.

## 6. Evidence boundary

### Measured or code-audited

- 12/13 frozen-corpus semantic IR reach and the one named negative;
- 5/13 static M1-shape count, explicitly not artifact/execution coverage;
- shipped JS bundle: 21,295 / 7,615 / 6,739 bytes;
- Rust evaluator PoC: 306,890 / 117,353 / 95,830 bytes and its SHA-256;
- absence of `wasm-opt` and therefore absence of a post-Binaryen number;
- local native Hermes/JSI/CLI artifact raw and gzip anchors;
- current `FunctionRuntime`, handler-host dependency, and IndexedDB/wa-sqlite
  repository state.

### Estimated or inferred

- full pared runtime: 5–15 MiB raw / 2–6 MiB gzip;
- its 275–826× gzip relationship to the current JS evaluator;
- cold-start and host-boundary direction; no Snapback WASM latency was measured;
- the proposed payload/latency bars in exit option C.

### Not claimed

- no Hermes, Ibex, or general handler runtime compiled to WASM;
- no `FunctionRuntime::WasmModule`, browser host, or local wasmtime/WAMR host;
- no `wasm-opt` result;
- no all-repository handler coverage percentage;
- no browser WASM capability, performance, Parity, or store claim.

Public sources were accessed 2026-08-05. Repository line references and byte
receipts are authoritative for this checkout; public sources establish only
external feasibility/performance context.
