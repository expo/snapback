# Route-group lowering rejects nested route params and null/union literal arguments

**Opened:** 2026-08-08 · **Severity:** P2 (blocks multi-child generated groups for real list contexts)
**Resolved:** 2026-08-08

Lane 3's rich list/detail bundle failed generation with
`ROUTES_ARGS_INVALID`: route lowering rejects a `routeParam()` nested
inside an object argument and cannot express the null/union literal
members the frozen Zerobugs list context requires. The control fell back
to primitive wrapper arguments plus a typed server-side merge — the root
of `W-QGROUP`/`W-MANUALSET`, and the reason the 22-relation graph shapes
live in hand-written handler code.

Ask: extend route-group argument lowering to structured contexts (nested
route params, null/union literals) so multi-child generated groups can
carry real query contexts. Owner seam: D2 (the LLP 0183 review round asks
D2 to own the graph/argument surface explicitly).

- **Claimed 2026-08-08:** session dc26442d (13-ticket sweep orchestrator) is executing this ticket now; sibling sessions should not duplicate.

## Resolution

Both named cases land. The governing contract is LLP 0092 §0E.6, amended
in the same commit ("Dated amendment: structured route-group arguments
(2026-08-08)").

**Root cause.** §0E.6's original text admitted "arrays/objects composed of
literals and references". The 2026-07-24 step-3 amendment narrowed it to
top-level positions for one stated implementation reason — "there is no
manifest-carried arg schema server-side". LLP 0131 later landed
`argsContract` on every function definition, so that premise no longer
holds for nested positions. The literal checker was separately too narrow:
`routeLiteralMatches` compared `typeof value === validator.primitive`, so
`v.null()`, `v.union([...])`, `v.array(...)`, `v.literal(...)` and
`v.vector(...)` members could never match.

**Admitted now** (`params-v1`, `formatVersion: 1` unchanged):

```js
{ function: 'listIssues', args: { context: {
  projectId: routeParam('projectId'),   // nested reference, any object depth
  cursor: null,                          // v.null() / v.union([v.string(), v.null()])
  sort: 'asc',                           // v.union([v.literal('asc'), v.literal('desc')])
  tags: ['open', 'ready'],               // v.array(v.string(), { maxItems: 4 })
} } }
```

Nested references are typed from the carried argument contract
(`function_nested_route_arg_types`); depth-1 references keep the AST-derived
`function_route_arg_types` typing byte-for-byte, so no app that lowers today
changes behavior (the existing demo corpus regenerates with zero drift).
Register/mixed group eligibility now follows references at every depth.

**Still refuses** (`ROUTES_ARGS_INVALID` / `SNAPBACK_BUNDLE_PARAMS_INVALID` /
`SNAPBACK_ROUTES_MANIFEST_INVALID`): a bare root reference; a reference
anywhere inside an array literal; a reference whose path is not resolvable
through object nodes or whose leaf is not a string/number/boolean argument
position; a reference beside other keys or with a non-string `$param`.

**Surfaces changed.** `packages/snapback-codegen/index.mjs` (two-pass
admission, widened literal matching, shared `routeMappingParamTargets`),
`src/bundle.rs` (`function_nested_route_arg_types`, path-aware
`substitute_params_v1` / `validate_mapping_references`), `src/local.rs`
(routes-manifest admission), `cloudflare/src/rqs-host.mjs` +
`cloudflare/src/coordinator.js`, `packages/snapback-client/react-binding.mjs`
and `rqs-preload.mjs` (recursive materialization and response matching).

**Two arm-parity defects found and fixed en route.** The Cloudflare arm's
`number` decode never compared the JCS canonical form against the presented
segment (so it accepted `"5.0"` where the local arm refuses), and it admitted
a bare root `{"$param": …}` mapping. Both now match the local arm.

**Remaining work (deliberate, not oversight).**

- References inside **array** literals stay refused: an index-addressed
  position has no stable declaration path in a template. If a real app needs
  `{ ids: [routeParam('id')] }`, that is a follow-on with its own path
  language.
- `v.tuple(...)` is not in LLP 0131's closed argument grammar, so tuple
  members are not covered; admitting tuple at argument positions is a
  separate decision.
- Depth-1 typing (plan-filter AST) and depth-≥2 typing (argument contract)
  remain two sources. Unifying them is follow-on; the depth-1 seam recorded
  in `issues/20260731-0112-register-eligibility-js-param-seam.md` is
  unchanged. Note that nested references *are* typable for JS-handler
  queries, because the argument contract exists regardless of handler form.
- This removes a compiler blockage. It does **not** by itself retire
  `W-MANUALSET`: the relational capability is still bounded to two-source
  shapes while the Zerobugs control composes up to 22 relations (LLP 0191 §5
  says exactly this).

Guide coverage is tracked separately in
`issues/20260808-guide-gap-structured-route-group-arguments.md`.
