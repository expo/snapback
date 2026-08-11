# guide-gap: no browser sessions mailbox relay for a Contract/Vite surface

**Status:** Open
**Opened:** 2026-08-10 · **Severity:** P2 · **Area:** auth · Contract/Exact adapter
**Related:** LLP 0059, LLP 0060, Diary 0074, `demos/pointing-room`, `demos/file-drop`

## Problem

`guide/auth/sessions-and-principals.md` explains the mailbox and the
request-code/exchange flow, and points at a separate browser recipe, but no
required page shows how a **Contract/Vite surface** obtains its one-time code in
local development without putting the admin token and impersonation capability
into browser code.

Building `demos/pointing-room` the answer had to come from reading
`demos/file-drop/vite.config.ts` and its `src/snapback.ts`: a dev-server
middleware holds the privileged carriers server-side and relays only the code.
That is the missing concrete composition, and it is currently discoverable only
as demo source.

This matters more for Contract than React because the Contract surface's boot is
already the least familiar part of the stack; an author debugging sign-in there
cannot tell whether they have an auth problem or a surface-boot problem.

## Desired resolution

- Add the dev-only mailbox relay to the browser auth recipe (or the sessions
  page) as a named pattern, with the explicit warning about what must never
  reach the bundle.
- Show it for a non-React surface, since the existing browser-auth material is
  React-shaped and the carriers question is framework-independent.
- Reference it from `guide/clients/contract-adapter.md`'s boot section, which is
  where a Contract author is standing when they hit this.

## Resolution (2026-08-10)

`guide/recipes/browser-auth.md` gains "Get the sign-in code in local
development", the serve-only dev mailbox relay as a named pattern, shown for
the **non-React** Contract/Vite surface: the credential resolver, the
`apply: 'serve'` middleware that answers one relay route and passes everything
else through, and the browser half (`authRequestCode` → relay fetch →
`authExchange`). It names what must never reach the bundle, and that the relay
is not an arbitrary Snapback proxy. `demos/file-drop/vite.config.ts` is
referenced as the React-side sibling.

Reachable from both places an author actually stands: the mailbox explanation
in `guide/auth/sessions-and-principals.md` and the boot section of
`guide/clients/contract-adapter.md`.
