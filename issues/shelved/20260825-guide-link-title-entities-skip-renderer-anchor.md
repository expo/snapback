# guide-gap: titled Markdown links whose title contains `&` or `'` are not rendered (and so not anchor-validated) by the docs site

**Status:** Open
**Opened:** 2026-08-25
**Systems:** Guide, Docs site, Tooling
**Related:** `scripts/guide-lib.mjs` (shared link grammar), `scripts/generate-docs-site.mjs`,
`issues/closed/20260815-docs-site-ephemeral-hook-anchor-red.md`

## Problem

The shared link regex in `scripts/guide-lib.mjs` is applied to raw Markdown by `checkLinks` and to
`escapeHtml`'d text by the docs-site renderer. The escaped-title alternative is
`&quot;([^&\n]*)&quot;`, so a link title containing `&` or `'` becomes `&amp;` / `&#39;` after
escaping and the renderer's match fails: the link is left as raw Markdown instead of an `<a href>`,
and the HTML validator never sees its fragment. `check-guide` still fragment-checks the source form,
so the source check is green while the rendered page silently loses the link.

No current `guide/` titled link hits this (found by review of the 2026-08-25 tooling landing; not
reproduced against a rendered build).

## Wanted

Parse links before HTML-escaping in the renderer, or accept entity sequences in the escaped title
group, and add a titled-link-with-entities case to `scripts/guide-freshness.test.mjs` plus a
docs-site render assertion.
