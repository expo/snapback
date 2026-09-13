# DX wish: first-party debug/receipt projection for the React live-query hook

**Opened:** 2026-08-08 · **Severity:** P4 (DX, demand-gated)

Diary 0067 recorded (and no ticket captured): `useSnapbackQuery`
intentionally omits the headless handle's version, answer class, resume
token, and pending-intents-at-seed fields, so the carrier witness had to
wrap `startLiveQuery` before provider construction to observe them. The
diary's ask: "a first-party debug/receipt projection would make future
carrier witnesses smaller."

Shape sketch: a dev-only `useSnapbackQueryReceipt(ref, args)` (or an
options flag projecting the receipt fields alongside data) that exposes the
headless receipt surface without wrapping the client. Demand so far: one
witness build; treat as demand-gated until a second consumer appears.

Filed by the 2026-08-08 comprehensive docs review (dedup sweep of recent
diaries).

## Status (2026-08-08 docs-review execution)

Not addressed; remains demand-gated as filed (one witness build so far).
The client-pages re-review that landed today did not add the projection,
but headless.md's completed method inventory now names the receipt-bearing
surfaces a wrapper would project, which slightly lowers the cost of a
future first-party implementation.
