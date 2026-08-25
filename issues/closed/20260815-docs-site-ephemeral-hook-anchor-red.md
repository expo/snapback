# Docs-site build red: ephemeral-state React-hook anchor missing

- **Filed:** 2026-08-15
- **Found by:** LLP 0259 Rung A landing lane (docs-site generator smoke run
  on a clean origin/main base)
- **Severity:** `scripts/generate-docs-site.mjs` FAILS site validation on
  main; the published docs site cannot be rebuilt until fixed

`guide/clients/react.md` and `guide/recipes/presence-cursors.md` link to
`../realtime/ephemeral-state.md#find-the-react-hook-from-ephemeral-vocabulary`,
but `guide/realtime/ephemeral-state.md` on origin/main no longer carries a
"Find the React hook from ephemeral vocabulary" heading (it appears to have
been renamed or removed by a recent ephemeral-state landing). The guide
checker's link pass accepts file-level links, so `check-guide` stays green;
only the docs-site validator resolves heading anchors, so the break
surfaces there:

```text
/clients/react/index.html: /realtime/ephemeral-state/#find-the-react-hook-from-ephemeral-vocabulary resolves to missing anchor
/recipes/presence-cursors/index.html: same target
```

## Resolution shape

Restore the heading (or retarget the two inbound links to the current
heading), then re-run `node scripts/generate-docs-site.mjs` to confirm the
site validates. Consider teaching the guide link checker to resolve
in-corpus heading anchors so this class fails at `check-guide` time instead
of at site-publish time.

## Resolution (2026-08-25)

Commit `ee34395b5` renamed “Find the React hook from ephemeral vocabulary” to
“Stop publishing when activity goes idle” while adding the activity-presence
helper; the two inbound fragments were not retargeted. Both links now point to
the current heading.

The docs-site heading slugger is now shared from `scripts/guide-lib.mjs`, and
`checkLinks` resolves same-page and in-corpus Markdown fragments against the
actual rendered heading/explicit-anchor set. The fail-first unit case proved
the old checker accepted a missing fragment. Enabling the check also surfaced
two older supervised-Expo links whose target heading gained an “Appendix”
prefix; both were trivially retargeted. Guide manifests, section/whole flats,
reference projections, and the diagnostics registry were regenerated.
