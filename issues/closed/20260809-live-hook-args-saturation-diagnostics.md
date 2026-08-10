# Unmemoized live-hook args saturate the main thread with zero diagnostics

Clique pilot, Snapback lane B3/B10 evidence: passing unmemoized
arguments to live-query hooks caused identity churn that saturated the
main thread — ~50 minutes of bisection with no console output, no
warning, nothing. The authoring skill DOCUMENTS this trap and the
builder still hit it, which is the point: documentation does not catch
what a runtime warning would. Ask: a dev-mode detector (arg identity
changing every render for N consecutive renders on the same hook site
=> console warning naming the site), mirroring React's own dev
warnings. Evidence: p2-pilot snapback-lane run-log.md.

## Resolution — 2026-08-10

Dev-only detector landed: a live-query hook site receiving
identity-churning unmemoized args for 5 consecutive rerenders warns once
per site (positively-identified dev builds only; WeakMap/warning body stays
out of the static production entry via the lazy diagnostic runtime).
Regressions cover firing, stable-args non-firing, changed-data non-firing,
and production non-firing.
