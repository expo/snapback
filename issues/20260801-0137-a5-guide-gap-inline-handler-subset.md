# A5 sweep: guide-gap — the inline_handler_v1 language subset is undocumented

**Opened:** 2026-08-01
**Systems:** Guide, Codegen
**Related:** LLP 0137 (A5 arm), LLP 0061 §5, demos/improvement-sweep/arms/a5-snapback-web/findings/0137-a5-f3-guide-gap-inline-handler-subset-undocumented.json

The inline handler subset is discoverable only by iterating against
generation refusals; the guide documents just the no-sibling-capture rule
(backend/queries.md anti-pattern). Restrictions the A5 arm hit, one
generate-diagnose-rewrite loop each:

1. `assistStep: dynamic computed member access is outside inline_handler_v1`
   — string indexing (`lower[i]`) and array-slot writes (`vec[slot] += d`)
   are refused. Standard rewrites the arm converged on: a
   `charCodeAt`/`charAt` walk for tokenizers, and index-matched
   `.map((v, i) => i === slot ? v + d : v)` for vector-slot accumulation.
   Any retrieval-scoring or embedding handler hits this immediately.
2. `defineJsMutation requires declared writes` — an empty `writes: []` is
   refused even for a read-only helper mutation an action calls via
   `runMutation`, forcing a declared-superset write list.

Conversely `JSON.stringify`/`JSON.parse`, `Math`, template literals,
arrow helpers declared inside the handler body, and `String.fromCharCode`
ARE allowed — nothing says so.

The generation-time refusal with file/line/column is the right failure
site (keep it); the gap is a missing subset reference. Fix shape: a guide
subsection stating what is refused (dynamic computed member access, free
identifiers outside the allowlist, sibling capture, empty writes) with the
standard rewrites, and what is allowed — CI-verified per guide
conventions.
