# LLP 1023 source and Snapback 2 0.0.29 release evidence

Published **2026-09-12 05:22:21 UTC**, with all three registry versions and
exact staged integrities verified at **05:32:12 UTC**. Source landed on
`origin/main` at `394ac17802f93983628c602f0f5e54670ecf5d64`.
The [publication process record](./publication-final29.json) and
[full output](./publication-final29.log.gz) retain exit 0 and the existing
publisher's 34.8-second result. Its append-only metric is in
`snapback2/metrics/loop.jsonl`.

Both native platforms passed **29/29 installed-consumer checks** with
production Hermes and media, using the same final canonical shim. The checks
include doctor, public exports, generated todo/chat apps, compiler guidance,
React bundles, a live query round trip, journey receipts and owned-process
cleanup. The [artifact and qualification record](./final-publication-artifacts.json)
contains both complete receipts and all SHA-512 integrities.

| Published artifact at 0.0.29 | Tarball SHA-256 |
| --- | --- |
| snapback2 | `7145038e61818186d405a887e0b33b3edb0c60d30e0cc5b684075fadad791e45` |
| snapback2-darwin-arm64 | `4abb7317f61c065d3d0b20ab91da728ea37965a46f338965600df4ea28a78b11` |
| snapback2-linux-x64 | `1abc233bb3c7cb10d7c5d6639b56af67ae407194f35ec1dfb8f2bdf04bd75364` |

The [first registry observation](./registry-final29.json) retains npm's
asynchronous umbrella-package 404 while both native artifacts were visible.
The [second observation](./registry-final29-attempt2.json) verifies all three
exact versions and integrities. No republish occurred between them. The
[Darwin final qualification](./final29-canonical.log.gz) rechecks the same
canonical shim already qualified on Linux. Earlier 0.0.27/0.0.28 and 0.0.29
stages remain historical artifacts in the run scratch directory; they were
not silently substituted for these final bytes.

Final source qualification is `75ee110fa1ccff019c994c667fd36b2d332ce8b7`:
the unchanged complete Snapback 2 script passes in **58 seconds**, with 1,450
package, 318 compiler and 1,199 native tests, both evaluator engines,
doctests and artifact verification. The landed integration has the same
Snapback 2 product source; retained publication metrics differ. Independent
[Sol](../../../llp/reviews/1023-clique-builder-jump.code-sol.md) and
[Grok](../../../llp/reviews/1023-clique-builder-jump.code-grok.md) reviews
both returned READY for the implemented changes and later guide integration.
The final 59-byte grammar restoration states an existing compiler rule and
is covered by the repaired guide assertions.

The [source qualification packet](./source-qualification/README.md) retains
the complete final log, earlier failed runs, byte measurements, hub/digest
and authority controls, and process cleanup. Its
[qualification mapping](./source-qualification/qualification.json) separates
executed successes from negative witnesses and source-only counterexamples.
The [integration comparison](./source-integration.json) records the sole
Snapback 2 difference between tested and landed commits: publication metrics.

The runtime is **89,843 / 90,000 bytes gzip**; the dedicated simplification
saved 143 bytes, leaving the 80,000 target unmet. The historical +1% growth
comparison remains failed on all four closures and its baseline is unchanged.
Final guide size is **98,237 / 98,304 bytes**. These results do not certify
digest final-emission eligibility, acquisition throughput or a completed
fresh Clique wave. The [parent](../../../llp/1023-clique-builder-jump.rfc.md)
and its children retain the actual implemented scope and open digest gap.

[Retained-file hashes](./retained-files.json) bind the copied raw records and
compressed logs. No package tarballs, credentials or benchmark application
data are committed here. Fresh build, independent grading and M7 evidence
will be recorded separately under the frozen 0.3.8-m8 instrument.
