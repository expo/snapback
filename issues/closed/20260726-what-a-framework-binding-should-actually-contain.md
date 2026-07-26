# Improvement: if we ship more framework bindings, the valuable content is not the query hook

**Status:** Resolved 2026-07-26 · **Kind:** improvement (design input) · **Filed:** 2026-07-26
**Evidence:** `demos/partitime/web/{vue,solid,svelte,react-vite}/NOTES.md`,
`demos/partitime/REPORT.md` §4, §6

## What

The Partitime matrix built Snapback frontends in React, Vue, Solid, Svelte,
Next.js, Expo, Exact/Contract, Flutter, SwiftUI and Compose. Snapback ships
bindings for React and Contract only. The obvious prediction was that the
five stacks with no bindings would suffer most.

**That is not what happened**, and the result should shape any future binding
work.

## The measurements

- **Vue** absorbed all three backends into a **68-line composable**. Its author:
  *"the 'no Vue bindings' problem was the cheapest problem."*
- **Svelte**: **76 lines** for all three backends, because
  `readable(initial, start → teardown)` *is* the shape of every realtime API
  involved.
- **React + Vite** — the one stack where bindings *do* exist — tested it
  head-on by implementing the layer twice. `useSnapbackQuery` takes a
  duck-typed provider, so it bridged to a hand-rolled client in **27 lines**.
  Adopting it replaced ~55 lines of a 1,048-line data layer: **about 5%.**

Every backend exposes the same primitive — *call me with new rows* — and every
reactive framework absorbs that in well under 100 lines.

## What actually cost time

Ranked by hours lost, from the React + Vite author:

> **rate limit ≫ CORS > grant/identity coupling > the missing client.**
> *"The missing client costs lines; the operational hazards cost the day."*

And the specific things every author had to rebuild, several of which **fail
silently**:

- re-subscription on identity change (a signed-in subscription otherwise keeps
  serving the signed-out user's rows)
- connection re-grant after socket loss (connected socket, zero server-side
  subscriptions, frozen forever)
- an error *state* rather than a rejected promise
- scope-dispose teardown
- the version guard
- jittered retry for `SNAPBACK_AUTH_RESERVATION_STALE`

## Proposed

**Do not prioritise `@snapback/vue` / `@snapback/svelte` / `@snapback/solid`
as query-hook packages.** The hook is the easy 10% and each community already
has an idiomatic shape for it.

If bindings ship, their content should be the list above — the lifecycle and
failure-mode concerns that are identical in every framework and that every
author currently rebuilds, usually incorrectly and silently.

The higher-leverage item remains
`20260726-snapback-client-cannot-carry-an-external-bearer`: one constructor
option unblocks every framework at once.

## Resolution

`guide/clients/framework-bindings.md` and LLP 0064 now define a binding around
the provider/external-store lifecycle rather than around hook syntax. The
contract covers identity retirement and blanking, socket re-grant plus fresh
subscribe, background/foreground, invalidation apply-before-ACK, typed
reservation retry, terminal-auth error state, and scope disposal.

The capability is marked partial: React and Contract projections ship, while
Vue/Svelte/Solid packages are deliberately not claimed. The shared JS client
now supplies the external-bearer constructor and lifecycle bridge that future
framework projections should reuse.
