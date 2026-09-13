# Snapback 4 — security review, 2026-09-13

**Reviewer:** Grok 4.6
**Requested by:** Charlie Cheever
**Scope:** Authentication, authorization, the HTTP host, identity, the partition log, assets, the store, and the client trust boundary across `snapback4/`. The 2026-09-12 architecture review assigned security holes to a separate pass; this is that pass. It makes no bakeoff or performance assessment.
**Baseline:** repository commit `6918cccbc264cf000982b03a5a11a2cf5563f885`; Snapback 4 package/crate version 0.1.15; working tree under `snapback4/` as of the review.
**Method:** Source inspection of the server, engine, identity, partition log, assets, and clients; one executable probe of server-minted id prediction. No delegated review. No production deploy, TLS terminator, or multi-user OS experiment was run.
**Related:** [LLP 3000](../3000-snapback4.explainer.md), [LLP 2000.000](../2000.000-keep-the-core-flip-two-substrates.rfc.md), [architecture review](./3000-architecture-code-review-20260912.md)

## Assessment

The authorization core is the right shape for the product: read and write rules run in the same interpreter as the program, hidden and absent are the same word on point reads, `sync` inversion is refused unless it matches the read rule, jobs are not caller-invokable on the wire, and `serve` refuses development personas. Session tokens are 32 random bytes stored as SHA-256 digests; passwords are argon2id; asset paths reject non-alphanumeric ids; SQL uses bound parameters.

The holes are at the host and identity edges, and at two engine oracles the rule model does not cover. The default development server treats loopback TCP as the developer and then answers every origin (`Access-Control-Allow-Origin: *`) including DNS-rebinding origins, so a web page can impersonate any persona and `POST /seed` as the system principal. The default `serve` bind is `0.0.0.0` over cleartext HTTP; passwords and bearer tokens share that socket. `/schema` and `/changes` require no principal. Unique-index refusals and the immortal partition log each disclose facts a read rule would hide. Argon2 and 64 MiB uploads run while the process-wide engine mutex is held.

Slice one explicitly leaves TLS to a proxy and at-rest encryption off the doing-list. Those exclusions do not cover the loopback door, the unauthenticated catalog, the uniqueness oracle, or log replay of deleted row images.

## What was reviewed and not found

Parameterized store queries; persona names cannot spell `system`; `serve` refuses `x-snapback-persona` and `/seed`; HTTP job paths are refused; asset ids cannot traverse; sniffed `Content-Type` is a static string with `nosniff`; the chat reference screen renders bodies as React text; client mutations send bearer tokens rather than cookies. Chrome Private Network Access is **not** a complete mitigation of the loopback finding (DNS rebinding makes the target origin local).

## Ticket index

P0 is an unauthenticated authorization bypass of the default development server. P1 is disclosure, brute-force, or denial of service against the claimed security model (rules, hidden=absent, tokens). P2 is a weaker oracle, missing bound, or future-facing footgun.

| ID | Priority | Filesystem ticket | Evidence |
|---|---|---|---|
| S01 | P0 | [Cross-origin use of loopback personas and seed](../../issues/20260913-snapback4-dev-cross-origin-loopback-doors.md) | Code + DNS-rebinding argument |
| S02 | P1 | [serve binds all interfaces over cleartext HTTP](../../issues/20260913-snapback4-serve-cleartext-all-interfaces.md) | Code + journal |
| S03 | P1 | [Unauthenticated schema dump and change feed](../../issues/20260913-snapback4-unauthenticated-catalog-and-changes.md) | Code |
| S04 | P1 | [Auth hashing holds the engine lock; no rate limit](../../issues/20260913-snapback4-auth-engine-lock-and-rate-limits.md) | Code |
| S05 | P1 | [Unique constraints oracle hidden rows](../../issues/20260913-snapback4-unique-constraint-existence-oracle.md) | Code |
| S06 | P1 | [Partition log replays deleted row images](../../issues/20260913-snapback4-partition-log-deleted-row-images.md) | Code |
| S07 | P1 | [Store and assets are created world-readable](../../issues/20260913-snapback4-store-world-readable-permissions.md) | Code |
| S08 | P1 | [Uploads write to disk under the engine mutex](../../issues/20260913-snapback4-upload-holds-engine-lock.md) | Code |
| S09 | P2 | [Server-minted ids leak the xorshift state](../../issues/20260913-snapback4-predictable-server-minted-ids.md) | Reproduced |
| S10 | P2 | [check does not refuse self-granting audience inserts](../../issues/20260913-snapback4-audience-self-grant-insert-rules.md) | Code |
| S11 | P2 | [Unbounded HTTP threads and no socket deadlines](../../issues/20260913-snapback4-unbounded-http-threads-and-timeouts.md) | Code |
| S12 | P2 | [View-once owner bypass and uncapped pixel dimensions](../../issues/20260913-snapback4-asset-once-and-pixel-bounds.md) | Code |
