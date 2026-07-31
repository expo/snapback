# Sessions-mode lifecycle-callback execution authority — design question

**Status:** OPEN — assessment recorded during W2e (2026-07-31); W2c
refused sessions callbacks at generation pending this design

Dev-lane callbacks execute through the staged-mutation path under the
asset owner's dev-admitted authority with client-mutation-ledger
idempotency. Sessions mode has no equivalent: the runner holds no
session bearer for the asset owner, and minting one would counterfeit a
session. The concrete design question, assessed with the sessions
authority seams fresh:

1. **What identity runs the callback?** The candidates: (a) a
   system-principal execution class (a trusted server-side authority
   distinct from any user session — does not exist today for app
   mutations; closest prior art is LLP 0055's service principals, whose
   grants are scoped and auditable); (b) the asset owner's identity
   under a server-minted, non-bearer execution context (needs a new
   0039-side authority class: "server-scheduled execution as user X,
   no session"); (c) refuse forever and require sessions apps to
   consume lifecycle state via live queries instead of callbacks.
2. **What does `ctx.auth` see inside the callback?** Whatever class is
   chosen must project honestly (LLP 0053's sealed `ctx.auth` closure):
   a callback authorized as "scheduled-on-behalf-of owner" must not be
   distinguishable-from-interactive in ways app code could exploit, or
   must be *explicitly* distinguishable (an `actorKind`), never
   ambiguous.
3. **Invalidation/witness obligations:** a callback writing app rows
   under (a) or (b) participates in commit-time validation and can be
   an authorization event producer like any mutation — no new 0053
   machinery expected, but the authority class needs its 0039/0055
   classification before any implementation.

Recommendation recorded (not decided): option (a) via an LLP 0055-style
scoped service principal minted per app ("asset-callbacks"), because it
reuses the audited grant vocabulary and keeps "who ran this" explicit
in receipts. Needs an 0039/0055-side dated amendment before code.
