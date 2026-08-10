# Published runtime omits the shipped admin-console bundle

**Status:** Resolved 2026-08-10
**Severity:** P2 (published-release defect; headless API and source-checkout workaround exist)
**Systems:** Admin console, Packaged dev loop, Runtime packaging, Publication qualification
**Date:** 2026-08-09
**Related:** LLP 0017, LLP 0041, LLP 0122, LLP 0189

## Problem

A freshly installed consumer app on the latest published Snapback release
(`@expo/snapback-cli@0.1.15` plus
`@expo/snapback-runtime-darwin-arm64@0.1.15`) cannot open the admin console
printed by the ordinary supervised dev loop. Visiting
`/_snapback/admin/` returns:

```text
Snapback Admin Console unavailable
SNAPBACK_CAPABILITY_EXACT_ADMIN_DIST_MISSING

The Snapback admin console is served from the Contract/Exact static build.
Build it, or set SNAPBACK_ADMIN_DIST to a built admin snapshot.
```

The published runtime package contains the server binary, Hermes artifacts,
and readiness metadata, but no admin static distribution. The CLI package also
contains no admin distribution. Consequently the normal installed-product
path has nothing for the server to discover or configure.

This contradicts the capability index, which declares
`operating.admin-console` shipped, and the authoring loop, which presents the
console as the normal browser debugger reached from `snapback dev`.

The diagnostic's suggested remediation is also source-checkout-only:

```sh
cd admin-ui
./build.sh
```

A scaffolded consumer app has no `admin-ui` directory and should not need a
Snapback source checkout or the Contract/Exact build toolchain to use a
published, shipped debugging capability.

## Reproduction

From a clean directory on Apple-silicon macOS:

1. Scaffold or install an Expo chat app using Snapback 0.1.15.
2. Run `bun install` and `bun run dev`.
3. Open the printed `http://127.0.0.1:<port>/_snapback/admin/` URL.
4. Observe `SNAPBACK_CAPABILITY_EXACT_ADMIN_DIST_MISSING` instead of the
   console.

Observed in the P2 pilot app at
`~/clique-runs/p2-pilot/snapback-lane/clique`; its dependency lock resolves all
Snapback packages to 0.1.15. The npm `latest` tag also resolves to 0.1.15 on
2026-08-09.

## Workaround

Build `admin-ui/dist` in a separate Snapback source checkout, then restart the
consumer app with `SNAPBACK_ADMIN_DIST` pointing at that snapshot. This is a
contributor workaround, not an acceptable consumer workflow.

## Done when

- The supported publication closure carries a build-matched admin-console
  snapshot, or otherwise installs it automatically, and the CLI configures the
  packaged runtime to serve it without user intervention.
- A clean, out-of-repository scaffold can run `bun install` then `bun run dev`
  and receive the real console from `/_snapback/admin/` without
  `SNAPBACK_ADMIN_DIST`, a Snapback source checkout, or an admin UI build.
- Publication qualification exercises the installed npm closure and asserts
  that the admin URL serves the console rather than
  `SNAPBACK_CAPABILITY_EXACT_ADMIN_DIST_MISSING` on every published runtime
  platform.
- The served console and guide/runtime identity are checked as one
  build-matched closure; the fix must not silently serve an arbitrary or stale
  admin snapshot.
- If a missing-dist diagnostic remains reachable for contributor/source-only
  modes, its remediation distinguishes that mode from a packaged consumer app
  and does not instruct consumers to `cd admin-ui`.

## Resolution (2026-08-10)

The admin build now emits a closed snapshot manifest binding the source
revision, dirty state, mount path, member byte counts and hashes, and a closure
digest. Both platform runtime packages carry that snapshot at `admin/`; their
runtime-readiness seal covers every member, and `@expo/snapback-cli`
automatically supplies the validated package path to the server. An explicit
contributor override still wins.

Publication preparation builds the locked admin surface before staging. The
staged-tarball qualification gate requires a clean snapshot matching both the
ledger and runtime-readiness revisions for every runtime platform. The
post-publish exact-version smoke additionally fetches `/_snapback/admin/` and
compares the response with the installed snapshot's sealed `index.html`, so
the missing-dist diagnostic cannot pass as a console.

The remaining missing-dist page is source/contributor recovery only. It tells
published-package consumers to reinstall the exact closure and gives a
root-relative contributor build command; it no longer instructs consumers to
`cd admin-ui`.

Focused proof covered snapshot tamper/dirty/revision failures, both runtime
package seals, the publication gate and post-publish smoke fixtures, the Rust
source-only diagnostic, and a real staged Darwin runtime served through the
CLI with `SNAPBACK_ADMIN_DIST` initially absent.
