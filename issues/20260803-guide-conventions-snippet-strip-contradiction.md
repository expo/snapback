# Conventions/checker contradiction: snippet leading-indentation stripping

**Status:** Open
**Impact:** 2
**Urgency:** 1
**Ease:** 4
**Confidence:** 5
**Systems:** Guide, check-guide
**Found by:** 2026-08-03 guide triage pass (a fence written per the
conventions text failed the checker)
**Date:** 2026-08-03
**Governing:** LLP 0061

## Problem

`guide/conventions.md` ("Code snippets") says a transcluded fence body
"must be an exact contiguous excerpt of the named file (leading indentation
may be uniformly stripped; trailing whitespace is normalized)". The actual
matcher (`scripts/guide-lib.mjs` `checkSnippets`) does
`fileText.includes(normalize(fence.body))` — trailing whitespace is
normalized, but there is NO leading-indentation stripping: the body must be
a literal substring of the source, indentation included. A fence authored
per the conventions text fails with "snippet is not a verbatim excerpt".

## Suggested resolution

Pick one and make them agree in the same change:

- amend the conventions sentence to "copy bytes exactly, including leading
  indentation" (cheapest; matches current corpus practice — existing fences
  all carry source indentation), or
- implement uniform-strip matching in `checkSnippets` if de-indented
  snippets are genuinely wanted for readability.
