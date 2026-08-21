# guide-gap: durable auth custody is process-global in Node without storagePartition

**Status:** Open
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
