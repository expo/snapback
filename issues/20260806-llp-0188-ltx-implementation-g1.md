# LLP 0188 implementation: vendor celld's ltx crate and pass G1

**Opened:** 2026-08-06
**Systems:** Storage, Backup and restore, Testing, CI
**Related:** LLP 0188 (Accepted 2026-08-06, rev `4baee93955f2820c`), LLP 0044, LLP 0057, LLP 0134

LLP 0188 is Accepted: continuous SQLite replication via a vendored LTX
replicator lifted from celld (`crates/ltx` — Rust port of Litestream
v0.5, format superfly/ltx v0.5.1, conformance-tested byte-for-byte
against the Litestream binary). This ticket is the first implementation
increment: **vendoring + gate G1**, which proceeds independently of the
four dated amendments (0057/0072/0099/0111 — drafted 2026-08-06,
Proposed, pending author ratification; they gate the hosted lane and the
0057-contract restore claim, not G1/G2 or the self-hosted lane).

**Scope (G1, per LLP 0188 §1 + §7):**

1. Vendor `crates/ltx` at a pinned upstream commit with a provenance
   receipt (Apache-2.0 attributions preserved; patch-clean except, if
   required, a storage-backend adapter — record the storage-seam finding
   either way).
2. Verify at the pinned commit: crate + transitive license metadata and
   required notices; provenance of the ported test vectors and of the
   reference Litestream binary the differential test drives.
3. Run the upstream vectors + `differential_xtool` in our CI on macOS
   and Linux with the reference Litestream binary **required present** —
   upstream self-skips without it; a skipped leg is a G1 **failure**.
   The G1 receipt captures the provenance facts as verified at the
   pinned commit, not by README reference.
4. Decide vendor-vs-crates.io (LLP 0188 OQ1) based on Deno's publishing
   posture at implementation time; record in the receipt.

**Explicit non-scope:** G2 (local kill-drill), G2f (fencing matrix), G3
(hosted binding), the replication runtime integration into
`src/storage.rs`, and any capability-manifest claim — LLP 0188 claims
nothing until the full corpus passes, and a replication capability id
additionally owes an LLP 0134 `MaturityIntroductionRecordV1`
(experimental-first) when it first appears.

**Follow-ons (file separately when G1 lands):** G2/G2f local drill
against MinIO (needs the object-store protocol with CAS +
per-credential immutability qualification — note `src/assets_s3.rs`
implements only `If-None-Match: *` create-if-absent today); frontier +
attach/succession runtime work; then the amendment-gated hosted lane.
