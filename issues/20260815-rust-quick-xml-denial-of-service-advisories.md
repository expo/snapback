# Replication's `quick-xml` dependency has two denial-of-service advisories

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Replication, S3/object storage, Rust dependencies, Security
**Date:** 2026-08-15
**Governing:** LLP 0188 (replication durability)
**Related:** `vendor/celld-ltx/Cargo.toml`, `src/replication.rs`, `Cargo.lock`
**Found while:** Whole-codebase security review (`cargo audit`, 2026-08-15)

## Problem

`cargo audit --json` reports two vulnerabilities in the compiled default
dependency graph:

- `RUSTSEC-2026-0194`: quadratic duplicate-attribute checking in a single XML
  start tag can pin a parser thread for minutes or hours.
- `RUSTSEC-2026-0195`: unbounded namespace-declaration allocation in
  `NsReader` can exhaust process memory.

The path is:

```text
snapback -> celld-ltx (default s3 feature) -> object_store 0.11.2
         -> quick-xml 0.37.5
```

This is reachable code, not a lockfile-only optional dependency.
`object_store` parses S3 list, multipart, copy, and credential XML responses
with `quick_xml::de::from_reader`; Snapback's replication path constructs that
S3 object-store client. A malicious or compromised configured endpoint can
therefore spend unbounded CPU or amplify response bytes into process memory in
the availability-critical replication process.

Both advisories require `quick-xml >= 0.41.0`. `object_store 0.11`'s semver
constraint currently keeps the graph on 0.37.x, so a lockfile-only update is
unlikely to be sufficient.

## Desired outcome

Upgrade the vendored `celld-ltx` object-store dependency to a compatible release
whose XML dependency includes both fixes, or carry a narrowly documented
backport while the upgrade is qualified. Preserve S3/R2/MinIO behavior and the
replication crash/retry contract.

## Acceptance

- `cargo audit` reports neither `RUSTSEC-2026-0194` nor
  `RUSTSEC-2026-0195`.
- S3 list, multipart upload, conditional write/copy, checkpoint, and restore
  coverage pass against the supported object-store profiles.
- The upgrade does not weaken response-size/time bounds or replication error
  classification.

