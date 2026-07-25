# admin-ui audit:production fails on new postcss advisory (GHSA-r28c-9q8g-f849)

**Opened:** 2026-07-24
**Found by:** ENG-25457 session (rung-2 witness delta replay) while running the
full local proof; unrelated to that change (no admin-ui files touched).

`bun run audit:production` in `admin-ui/` now fails:

```
postcss  <=8.5.17
  vite › postcss
  high: PostCSS: Path Traversal in Previous Source Map Auto-Loading
  (sourceMappingURL) leads to Arbitrary .map File Disclosure
  — GHSA-r28c-9q8g-f849
1 vulnerabilities (1 high)
```

This is a newly published advisory against the pinned transitive `postcss`
(via `vite`), so the failure is time-based ecosystem drift: any checkout of
main fails the proof's admin-ui audit gate today. `build.sh`, `bun run test`,
and `bun run test:browser-security` all still pass.

Fix: bump `vite` (or add a resolutions override) in `admin-ui/` so the
transitive `postcss` clears `<=8.5.17`, regenerate `bun.lock`, and re-run the
admin-ui gate. Keep the audit gate itself — this is exactly the drift it
exists to catch (ENG-24575 posture).
