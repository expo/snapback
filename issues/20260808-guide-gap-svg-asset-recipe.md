# guide-gap: SVG through the typed asset lifecycle has a safe adapter pattern the guide doesn't teach

**Opened:** 2026-08-08 · **Severity:** P3 (guide-gap)

The native trusted image detector intentionally treats active SVG as
opaque, so an app whose frozen accepted-image set includes
`image/svg+xml` cannot declare it on the ordinary image intent. The
Zerobugs control built the safe adapter (server-side exact MIME/length/
signature validation → separately named opaque native intent → typed
`v.assetRef` attach → delivery alias with `nosniff` + sandbox CSP;
`C-ASSET` in the control PLAN, live-verified in the Lane 5 receipts). The
guide should either teach this adapter as the recipe or name SVG an
explicit GAP so the next app doesn't rediscover it.
