# guide-gap: durable auth custody is process-global in Node without storagePartition

**Status:** Open — reopened 2026-08-21 after independent review
**Systems:** Guide, snapback-client custody
**Date:** 2026-08-18
**Evidence:** diary 0096 M2 ("every persona wrote as Henry"); its essay calls
this the single most expensive fact of the lane.

Multiple `createSnapbackAppClient` instances in one Node process share the
same durable session unless `storagePartition` is set. Any multi-persona
harness (acceptance suites, seed replay, bots) hits this. Wanted: a loud
callout on the client/custody guide pages + the headless-client page, and
ideally a diagnostic when a second client adopts an existing durable session
in-process. Related hardening context: the 0.1.24 owner-key isolation series
(108545929..e674ee382) fixed cross-APP sharing; this is the in-process
multi-client seam of the same subsystem.

**Additional evidence, 2026-08-20/21:** diary 0104 reproduced the behavior on
current local main while building the Explicit Clique acceptance replay.
Multiple actor clients adopted the same default durable authority and wrote as
one persona until the lane assigned one `storagePartition` per actor. The
correct API exists; the default remains surprising for the ordinary
multi-persona test/agent case.

## Reopening note — 2026-08-21

The recipe, links, and retrieval route landed, but closure named only static
Guide checks. LLP 0295 requires a packed-external vertical contract receipt for
this changed advertised client path. Until the ticket names retrieval through
packed import/runtime/client behavior and a negative diagnostic, the exit is
not met.

## Partial implementation

Added `guide/recipes/multi-persona-clients.md` and loud custody links from the
sessions and headless-client pages. The recipe assigns one stable
`storagePartition` per persona/worker, verifies the settled principal, and
covers restart and negative isolation evidence. Retrieval case 60 preserves
the diary phrase “every persona wrote as Henry” plus the exact Node/default
partition vocabulary. The retained cold run at
`guide/eval-runs/2026-08-21/multi-persona-clients.md` passed in 11/15 tool uses.

Partial evidence: retrieval, Guide, and first-read checks pass. They do not
satisfy the missing packed vertical contract.
