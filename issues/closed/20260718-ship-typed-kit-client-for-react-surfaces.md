# Ship types for the kit client so React surfaces stop hand-writing them

**Status:** Closed
**Severity:** P3
**Systems:** Clients, DX, Codegen
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-18
**Related:** guide/clients/react.md; demos/cursors-web/surfaces/react/src/snapback-kit.d.ts; demos/all-aboard/surfaces/react (allowJs + `as never` casts); demos/shindig/surfaces/react (diary 0015)
**Marker:** typescript, kit-client, react-arm, hand-wiring-cost

The React arm consumes `demos/_kit/client.mjs` untyped. Every TS surface has
now paid the same tax a different way:

- cursors-web hand-wrote an ambient `snapback-kit.d.ts` for the subset it
  uses (explicitly recorded as hand-wiring cost, ENG-22531);
- all-aboard turned on `allowJs` and sprinkles `as never` casts at each seam;
- shindig did `allowJs` plus local structural interfaces for the
  `liveQuery` handle and options.

Each copy covers a different slice, goes stale independently, and the
sharpest seams (`liveQuery` option/handle shape, structured mutation results,
diagnostic-carrying errors) are exactly where type help matters. The
generated `api.d.ts` already types the function references — it's the client
itself that is blind.

The React-arm guide frames hand-wiring ~20 lines of glue as deliberate;
hand-typing the client is not part of that bargain.

**Done when:**

- A maintained declaration ships next to the kit client (`client.d.mts` or a
  JSDoc-typed source that `tsc` can consume) covering at least: constructor
  and options, `health`, `ensureApp`, `query`/`mutate`/`action` with
  structured results, `liveQuery` options + handle (rows, connection axis,
  dispose, poll), `subscribeEphemeral` overlays, and the error shape with
  `diagnostic.code`.
- At least one existing React surface deletes its ambient copy / casts and
  typechecks against the shipped types (shindig is a ready guinea pig).
- The React-arm guide notes the types come with the kit, and drift is covered
  by a typecheck somewhere in the local proof (e.g. one surface's
  `tsc --noEmit` already runs there).

## Resolution

Closed 2026-07-18. `demos/_kit/client.d.mts` now types construction, structured
calls and errors, live-query handles, connection callbacks, receipts, and
ephemeral overlays beside the JavaScript client. Cursors-web dropped its
handwritten client ambient declaration, while All Aboard and Shindig consume
the shipped live types directly. All three React surfaces pass their existing
TypeScript checks, and the React guide identifies the adjacent declaration as
the supported source of truth.
