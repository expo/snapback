# DX5 verification — target 0.4.36

`qualification/consumer.json` records a fresh packed Linux consumer qualification
at `7d39c6229e441485c5845280e3570ce4e768a80e` (proot Ubuntu 24.04 and Alpine).
All host and isolated userspace cases passed. This is explicitly consumer-only:
`publicationQualified: false`, with the monolithic suite not invoked. The user
prohibited `scripts/test.sh`; the full five-crate Cargo run and affected client
runs were performed separately. No version bump or publication occurred.

`full-rust.json` records the completed full run and every corrected failing
target rerun. Logs are gzip-compressed verbatim under `test-logs/`. The initial
full run had eight failing targets: stale expectations for the new source
advice/generic refusal help and a zero-duration flock observation. Their corrected
reruns all pass; the executable authorization assertions remain.

`qualification/dx5-proof.json` includes six installed-old-CLI upgrade cases
(ordinary, quiet, JSON+quiet for 0.4.33 and 0.4.35). Public npm supplied 0.4.33.
Public npm still returned 404 for 0.4.35 on 2026-10-21 at 08:59 UTC; its cases use
the retained wave-20 registry package, with integrity recorded. Candidate metadata
is aliased to 0.4.36 inside the isolated acquisition proxy so both old CLIs acquire
it; the repository and actual candidate native version remain 0.4.35. This does
not claim a public-npm 0.4.35 upgrade test.

`reviewed-product.json` confirms all 45 reviewed product/guide/amendment files
still match the round-5 source manifest. Both independent reviewers returned
READY; verbatim output and provenance live in `llp/reviews/dx5/`. Later commits
only correct tests and retain evidence.

`frontend.json` records three untouched wave-20 originals and typechecked copied
migrations using the frozen harness frontend bucket. `data-json-scan.json` records
the 17-of-50 legacy data-JSON candidates. Temporary projects, packs, local target
builds and workstream temporary logs were removed after evidence retention.

Main commands (each executed with an outer timeout):

```sh
timeout 7200s env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test --no-fail-fast -p snapback4-core -p snapback4-lang -p snapback4-device -p snapback4-sim -p snapback4
timeout 7200s env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 node scripts/qualify-linux.mjs --consumer-only --client target/dx5-final-pack/snapback4-0.4.35.tgz --expo target/dx5-final-pack/snapback4-expo-0.4.35.tgz --out target/dx5-qualification-6
```

See the worktree-root `WORKSTREAM-REPORT.md` for per-item commits, Mac evidence,
root checks and the external publication limitation.
