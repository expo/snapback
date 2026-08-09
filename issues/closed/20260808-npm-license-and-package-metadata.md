# P0: no LICENSE anywhere despite ratified MIT; zero npm metadata; funnel gate excludes the first-installed packages

**Status:** Open
**Opened:** 2026-08-08 · **Severity:** P0 (license) / P1 (rest) · **Area:** packaging / package READMEs / funnel gate

From the 2026-08-08 agentic surface audit (LLP 0202 themes 5 and P0 #3).

1. **Unlicensed on npm.** LLP 0033 ratified "Option 1 — MIT eyes-open" on
   2026-07-01 (`llp/0033-license-posture.decision.md:55-72`, explicitly
   noting P6 packaging proceeds under MIT). The packaging change never
   happened: no `LICENSE*` file exists anywhere in the repo (root
   `README.md:392` asserts "MIT" anyway), and none of the 13 publishable
   manifests carries a `license` field. npm renders the packages unlicensed;
   automated dependency policies — the kind agent harnesses run — refuse
   unlicensed packages outright.
2. **Zero registry metadata.** No published manifest has `repository`,
   `homepage`, `bugs`, or `keywords`. A cold agent on the npm page has no
   route back to source or an issue tracker.
3. **Funnel gate excludes the first-contact packages.**
   `scripts/package-readme-funnel.test.mjs:13-21` gates seven packages;
   `snapback-client` and `snapback-react` — the two an app author installs
   first — are not among them, and neither README carries the
   out-of-checkout documentation block (`grep -c 'snapback guide'` → 0 for
   both). LLP 0187 T4 landed the other five; these two were never in scope.
4. **README link hygiene.** All ten client-facing READMEs link docs as
   `http://127.0.0.1:4287/...` (dead on npmjs.com); only four carry the
   "use the origin printed by `snapback dev`" caveat. Add a stable
   pre-install orientation paragraph (what the package is; docs are served
   post-install) — this half does not depend on the LLP 0195 docs-site
   author gates.
5. **Package disposition strays.** `@expo/snapback-sidecar` sets
   `publishConfig.access: "public"` with no `private: true`
   (`packages/snapback-sidecar/package.json:24-26`) yet is absent from
   `PACKAGE_INVENTORY` (`scripts/snapback-publish-core.mjs:49-61`), the
   funnel test, and the entire guide (zero hits). The two
   `@expo/snapback-runtime-*` packages ship no README at all.
   `packages/snapback-harness/` has no manifest despite sitting inside the
   `packages/*` workspace glob. Decide published-or-private per package; a
   public manifest with no inventory row is a false claim either way.
6. **Version identity.** `guide/reference/registry.json:7-12` stamps
   `packageVersions: 0.1.0` for all four client packages — a version that
   does not exist in the published closure (`newestPublished: 0.1.15`).
   Derive the stamp from the publication ledger, or record `closureVersion`
   alongside and label which is which.

## Fix

Root `LICENSE` (MIT) + `license`/`repository` (with `.directory`)/
`homepage`/`bugs`/`keywords` in every published manifest; extend
`packageNames` in the funnel test to every non-private package and assert the
license field, the funnel block, and the port caveat; add the two READMEs'
funnel blocks and the runtime/sidecar READMEs (or `private: true`);
ledger-derived version stamp in the generated reference.

## Resolution (2026-08-08)

Added the ratified MIT license at the repository root with Expo repository
ownership reflected as `650 Industries, Inc.`, and added `license`, repository
directory, homepage, bugs, and keywords metadata to all 13 manifests that had
claimed public publishability when this ticket was filed. The package README
gate now discovers every non-private workspace manifest, cross-checks the main
publication inventory, and requires the MIT field, checkout-independent Guide
funnel, port caveat, and packed README.

`@expo/snapback-client` and `@expo/snapback-react` now have stable pre-install
orientation and complete served-Guide/MCP funnels. Both runtime packages now
ship README funnels, and the other public READMEs carry the port caveat. The
uninventoried `@expo/snapback-sidecar` manifest is now private and no longer
claims public registry access; LLP 0129 calls the implementation
"productized," so an author may later choose to promote it, but that must add
an explicit inventory/capability/publication contract rather than relying on
the old stray manifest. `packages/snapback-harness` now has a minimal private
workspace manifest describing its in-repository role.

Finally, `scripts/generate-symbol-registry.mjs` binds
`buildIdentity.packageVersions` and `publishedClosureVersion` to
`guide/published-closure.json`, while retaining separately labeled
`sourceManifestVersions`. The generated registry and Guide projections were
regenerated through their canonical scripts.
