# HV round 2 — review corrections

Both correctness findings are fixed. The residual format-3 cache scenario is
prevented by an existing built-in version/error fence; a detecting browser
regression now proves it. Word-index deferral remains unimplemented.

Final production wasm: **2,033,531 B raw / 602,216 B gzip**, **173 B smaller**
than round 1's 602,389 B. The unchanged **593,719 B** cap remains missed by
**8,497 B**. WD owns the separately commissioned reductions in main; no budget
increase or publication qualification is claimed here.

Merged origin/main `38abb89b8e0b206644b9e2619c6f2d159a981d23` before
implementation, in `8474e39603`. Both journal conflict hunks retain both sides.
The starter, KR and publication test changes survive. There was no delivery-await
conflict and no production TypeScript change; the `awaitBoundary()` detecting
test passes against the existing generated inventory.

## Certification admission

Previously `scan_acquisition_basis` selected and charged a page while already
inside an unbounded prepaid scope. Restoring that scope concealed its peak from
the caller. The new group admission reads the saved caller's ceiling and occupied
heap, chooses 32 rows only if the complete page fits, and reserves the declaration
before entering prepaid work. That reservation includes the 32 decoder bounds,
rule scratch and both result vectors. Otherwise it reserves the original single
candidate; if even that fails, no source scan runs. Success and error restore
nested caller state. Every fetched candidate still crosses the existing expiry,
row-rule and field-disclosure checks. The ordinary query/writer/stream procedure
is unchanged. The implementation is SQLite-gated and adds no wasm path.

The observing Rows adapter records actual scan requests and measures real tagged
JSON decoding allocations inside each request. It tests a small ceiling, a
ceiling too small for page overhead, a nearly spent larger ceiling and a roomy
ceiling, both directly and inside an enclosing prepaid scope. Payloads are empty
or 256 KiB; every case returns the independent expected count of 64. With 256 KiB
payloads, fallback requests exactly one row and allocates at most **263,776 B**
per scan; the roomy path requests 32 and allocates **8,417,160 B**. A decoder
reservation that cannot fit refuses before any storage request. The pre-return
request observation is essential; the regression does not infer fallback from a
restored heap peak or an unchanged count.

`cold-before.log.gz` reproduces 32-row requests under a 180,736 B ceiling.
`cold-mutant.log.gz` replaces the saved allowance with `(u64::MAX, 0)` in the
fixed code; the final regression again fails on the observed 32-row request.
LLP 3000.015 §3 records the corrected reservation boundary.

## Canonical staged images

Publication serializes the parsed row once and shares its staged substring only
when the entire canonical encoding matches. A noncanonical stage keeps that
canonical string instead. The old wrapper-only brace scanner is removed. The
normal path still shares the stage's backing allocation with the published row;
its extra serialization is one transient row, never a whole page or partition.
Loaded rows and ordinary puts already normalize through this codec.

The regression publishes staged rows containing `[{},{}]`, nested arrays/maps
and tag-like text. It exercises whitespace before tagged colons, pretty JSON and
Unicode-escaped Row/Map tags. It then performs actual metered MemoryStore scans,
compares results and the minimum admitted heap with an ordinary canonical put,
and checks that one byte less refuses. The stored row image must be canonical.
`images-before.log.gz` reproduces the review's subtraction overflow; the fixed
memory/publication checks pass. LLP 3000.007 §20.4 records the invariant.

## Long-lived format-3 adapters

The built-in public adapter attempts physical version 2 on **every** operation.
Once another object moves the name to physical version 3, that open returns
VersionError; `request.onerror` clears `packing` before retrying version 3. A row
save therefore reads the committed marker and uses RowPages. This also covers
an object that cached logical "3" after an aborted migration at physical version
3. The built-in page/Worker owner migrates on load and keeps format 4; the page's
conditional metadata writer uses the public reopening adapter. Exclusive store
claims prohibit a second built-in owner from migrating between a format read
and save, and the Worker refuses other operations during a conditional commit.
The proof does not grant custom providers concurrent migration permission.
Actual old version-2 clients refuse the physical upgrade rather than interpreting
pages.

The new Chromium test keeps one old object alive through failed migration,
reloading logical "3", successful migration by another object, a rejected
conditional save, an accepted conditional update/delete/metadata save and an
ordinary insert/base-delete save. It checks the final logical rows, point read,
strict transactions and absence of stray buckets or direct packed records.
The existing code passes; deleting `packing.delete(name)` fails because the old
row remains visible instead of its accepted update (`packing-mutant.log.gz`).
No production persistence change is necessary.

LLP 3000.007 §20.4 now states the custom-provider rule: preserve exclusive
ownership and either re-read format inside each write transaction or atomically
fence stale format owners. A cached layout cannot survive an independently
committed migration.

## Validation

The affected core unit target passes **168**, with one declared ignore (its
self-spawned detecting child also passes). Memory/publication-focused tests pass
**18/18**, browser migration/review tests **17/17**, and browser durability,
navigation, Worker control and acquisition tests **114/114**. The whole guide
passes **99/99**; delivery await classification passes **1/1**. Package build and
reference validation pass. The broader affected device run passes **1,390**
with five declared ignores. Logs are unedited gzip archives.

Ran `scripts/test.sh` **exactly once**, exit **1**. Its exact summary is:

```text
== 2 failure(s) in 1339 s
   wasm build
   client tests
```

Every failed stage and test:

| Failure | Classification | Disposition |
|---|---|---|
| wasm build: 602,216 B gzip exceeds 593,719 B | Ours, retained HV size debt | Unresolved; 173 B smaller this round, no cap increase |
| `web-reachable typed JSON calls all use the codec funnel` | Ours | New JSON fixture helpers needed an explicit function-level `#[cfg(test)]` for the source census; corrected |
| `census kills parse, encoded, MQ components and container regressions` | Ours | The same two fixture calls added unexpected census diagnostics; corrected by the same test-only marker |

After that client stage, added the explicit test marker and its comment.
The complete codec census then passes **26/26** and the staged-image regression
passes **1/1**. No census assertion, production behavior, wasm or test body changed.
The single full run retains those two client failures; it was not repeated.

All other stages pass. Rust passes **4,349** (4,332 target tests plus 17 doctests),
with 33 declared ignores. Clients pass **5,197**, fail the two tests above and
have ten existing skips, zero cancellations. Fixture wrappers pass **9/9**;
serial client models pass **79/79** with their full 10,000 session and 3,000
online sequence counts. Baseline and environmental test failures: **zero**.
The inherited 60-second process budget remains exceeded; no count, timeout,
heap/wasm ceiling or durability requirement is relaxed.

`source-before-suite.json` and `source-final.json` bind the implementation and
tests. The only differences during/following the run are that explicit test-only
marker, clarifying LLP wording and the canonical-pricing `@ref` comment added
during final review. Production behavior is unchanged from the tested source.
`FAILURES.md` also records expected detecting controls and corrected setup errors.

Reproduction, from `snapback4/`, with the build/test environment below:

```sh
cargo test -p snapback4-core --lib
cargo test -p snapback4-device --lib --tests
cargo test -p snapback4-lang --test guide
node --test packages/snapback4/test/web-pages.test.mjs packages/snapback4/test/web-review.test.mjs
node --test packages/snapback4/test/web-durability.test.mjs packages/snapback4/test/web-navigation.test.mjs packages/snapback4/test/web-worker-control.test.mjs packages/snapback4/test/acquisition.test.mjs
bash scripts/test.sh
# Focused checks after the source-census correction:
node --test packages/snapback4/test/wasm-codec-census.test.mjs
cargo test -p snapback4-device --lib noncanonical_staged_rows -- --nocapture
```

`cold-before` and `images-before` run the new regression against unfixed code.
To reproduce `cold-mutant`, replace the saved `(limit, used)` selection in
`certify_acquisition_group` with `(u64::MAX, 0)` and run the `cold_basis_scan_requests`
core unit test. To reproduce `packing-mutant`, remove `packing.delete(name)`
from `web-idb.ts`'s `request.onerror` and run the new `long-lived format-3`
case. Both must fail; restore each mutation before qualification.

## Measurement limits

This round does not repeat the five-run heavy-account timing campaign. Earlier
rounds' medians remain historical measurements, not measurements of this repair.
Canonical comparison adds a row serialization during publication; no new latency
improvement or zero-regression claim is made. The generated 6,000-row heavy
regression passes with **20,551,766 B peak / 15,029,122 B retained**, versus
**37,727,851 B** for the old retained representation: the new peak is **54.5%**
of the old retained allocation. The largest
bridge string is **302,739 B**; complete acquisition and offline restore pass.
Those allocation figures match round 1. Its raw diagnostic elapsed time is
retained in the log but is not a timing comparison: builds/tests were active.
All ordinary and word indexes still finish before publication, delivery
qualification and prediction replay.

Build/test environment: eb1000, Node 24.13.1, Rust 1.97.0, wasm-bindgen 0.2.127,
Binaryen 132, eight Cargo jobs/test threads and packaged SQLite flags
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`. Tests/builds may overlap;
no overlapping execution is reported as a performance comparison.

The repair commit follows the local merge; both carry
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
Nothing pushed or published.
