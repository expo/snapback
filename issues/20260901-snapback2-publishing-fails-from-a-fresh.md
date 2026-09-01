# snapback2: publishing fails from a fresh checkout before prepack builds dist

**Status:** Open
**Systems:** snapback2, publish, package build
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/scripts/publish.mjs:38-44

Failure scenario: in a fresh checkout with dependencies installed but gitignored packages/snapback2/dist absent, publish builds Rust/Hermes and then runs doctor with SNAPBACK2_COMPILER pointing to nonexistent dist/compiler.mjs. Doctor fails before npm prepack gets a chance to build that directory.

Why it happens: publish performs no package build before its doctor qualification. The only build hook is packages/snapback2/package.json prepack, invoked later during the second npm publish.

Suggested fix: explicitly build the package before doctor, qualify that exact immutable dist snapshot, and ensure prepack reuses or verifies it rather than silently rebuilding different bytes. Add a clean-tree dry-run test with dist removed.
