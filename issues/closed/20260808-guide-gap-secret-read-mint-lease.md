# guide-gap: two pages require a "separately minted --secret-read-lease" nobody documents how to mint

**Opened:** 2026-08-08 · **Severity:** P3 (documentation)

guide/operating/observability.md:72-74 and
guide/operating/error-tracking.md:78-80 both instruct the reader to
"provide … a separately minted `--secret-read-lease`", and
guide/operating/host-ops.md:229-231 names `secret-read-mint` only in
passing. No guide page documents the only way to mint that lease:
`snapback secret-read-mint` with its scope flags (`--table`, `--function`,
`--explain-function`, `--telemetry-events`, `--telemetry-export`,
`--errors-issue`, `--admin-inspect`, `--receipts`) and budget flags
(`--ttl-seconds`, `--row-budget`, `--byte-budget`) — src/cli.rs:868-896.
The catalog row `secretRead.mint` has Guide `—`
(guide/operating/agent-controls.md:211).

Ask: one short "mint a scoped secret-read lease" section (host-ops.md or
observability.md) that both dependent pages and the catalog row can link.

Found by the 2026-08-08 comprehensive docs review (operating slice).

## Resolution

Fixed 2026-08-08 (docs-review execution, 1284ae8a5). host-ops.md gained
"Mint a scoped secret-read lease" — the `snapback secret-read-mint`
example, the `sbrl_` lease-field-to-flag/header mapping, all eight scope
flags, and the three budget flags with their defaults (60 s / 500 rows /
1 MiB, verified against src/cli.rs) — and both dependent pages
(observability.md, error-tracking.md) now link it. The `secretRead.mint`
catalog row's Guide cell was wired to the new anchor at integration.
