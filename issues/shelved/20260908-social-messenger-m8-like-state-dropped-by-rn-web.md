# Social-messenger M8 cannot observe stock like state on RN Web 0.21.2

Status: Open
Filed: 2026-09-08
Scope: frozen social-messenger 0.3.6-m8 instrument interoperability

M8's `findUnlikedAlicePost` requires an explicit false selection attribute on
`sm-post-like`; `toggleSelection` accepts `aria-pressed`, `aria-selected`,
`data-selected`, or `data-liked` (`choreography.mjs:2525–2550`). The stock
`ui/src/FeedCard.tsx:111–125,222` passes its `liked` boolean through
`accessibilityState={{ selected: active }}` on the correct Pressable.

That prop shape is insufficient with React Native Web 0.21.2. A synthetic
`renderToStaticMarkup` control using React 19.1.0 and the exact installed
RN Web dependency renders **neither false nor true selection attributes** for
the stock prop shape. Direct `aria-selected` controls produce the corresponding
false/true attributes. RN Web's `forwardedProps` and `createDOMProps` handle the
direct ARIA prop but do not handle `accessibilityState`.

Actual command, output, versions, timestamps and dependency hashes are retained
in [the renderer control](../../benchmarks/runs/2026-09-08-release-cold-headroom/m8-like-renderer-control.json).
This executes the renderer with synthetic props; it imports no application,
reads no application data, and is not a newly driven browser or application
grade. The source-only audit initially found a plausible prop path; the executed
dependency control establishes where that path loses state for this version.

Repair the stock action's web semantic state in the next instrument version,
using an explicit boolean attribute the observer reads (prefer `aria-pressed`
for a toggle button), while preserving native accessibility state. Add an actual
RN Web rendered regression for both false and true states and the M8 selector;
the existing choreography self-test uses handcrafted `aria-pressed`, so it
misses this integration. Bump the instrument version and retain the frozen run.

This finding was not supplied to the cold builder or fresh assessor. It does
not establish the app's Insights correctness or resolve the separate M8
dual-offline convergence failures.

## Triage — 2026-09-11 (UTC)

**Disposition:** Open — stock web semantic-state mismatch. **Triage priority:** P2.
**Audit source:** `15c134d056`; Codex, on the author's request to reconcile tickets.
This disposition supersedes stale current-work claims above; historical observations remain unchanged.

Current FeedCard still uses accessibilityState.selected for its Action, while the ticket's exact RN Web 0.21.2 renderer control demonstrates that neither boolean becomes the attributes the M8 observer reads.

Next instrument revision: retain native accessibility and expose explicit true/false web toggle state, then execute the real renderer and M8 selector controls. Handwritten self-test ARIA does not cover the stock component boundary. No new renderer run or application-grade claim in this audit.
