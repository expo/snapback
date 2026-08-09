# Swift arm cannot be consumed or tested outside the repo; capability row implies it can

**Status:** Open
**Opened:** 2026-08-08 · **Severity:** P1 · **Area:** clients/swift / guide/clients/swift.md / capability index

From the 2026-08-08 agentic surface audit (LLP 0202 theme 5).

Three compounding gaps make the Swift arm repo-only in practice:

1. `Package.swift` lives at `clients/swift/SnapbackClient/`, not the repo
   root, so `.package(url: "https://github.com/expo/snapback", …)` cannot
   resolve it — and there are no semver tags (`git tag` shows only
   `qualified-package-staging-*` and bundle-baseline tags).
2. `guide/clients/swift.md:22-33` has no dependency-declaration snippet at
   all — it jumps from "ships as a SwiftPM library for macOS 13+ / iOS 16+"
   straight to `SnapbackClient.Configuration(baseURL:)`.
3. The test suite reads its conformance corpus from
   `schemas/live.wire-fixtures.v1.json` via a `SNAPBACK_REPO_ROOT` path with
   no `resources:` declaration
   (`Tests/SnapbackClientTests/FixtureConformanceTests.swift:158-165`), so
   `swift test` is impossible from a consumed package. There is no README
   anywhere under `clients/`.

Meanwhile the `clients.swift` capability row reads `partial`, implying
consumability, and the Swift arm's client-originated errors carry no stable
codes (tracked separately in
`issues/20260808-uncoded-throws-and-untyped-client-errors.md`).

## Fix

Either (a) publish a tagged mirror (root manifest, bundled fixture
resources, semver tags), or (b) state the "in-repo proving client, not
consumable as a dependency" boundary explicitly in `guide/clients/swift.md`
and the capability row. Either way, add the missing dependency-declaration
snippet (or its explicit non-claim) and a `clients/` README.

## Resolution (2026-08-08)

Implemented option (b) without creating an external repository or tags.
`guide/clients/swift.md` now states that the nested SwiftPM package is an
in-repository proving client, gives an explicit dependency-declaration
non-claim where installation guidance would otherwise appear, and documents
the repository-root `SNAPBACK_REPO_ROOT` test command. The `clients.swift`
capability row now carries the same not-published/not-tagged/not-consumable
boundary.

Added `clients/README.md` to document the client-tree layout, the exact
in-repository Swift test invocation and fixture-root requirement, and the
external-distribution work that remains deliberately unclaimed.
