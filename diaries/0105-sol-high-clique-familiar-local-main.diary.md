# Diary 0105: Sol-high Clique Familiar on unpublished local main

**Date:** 2026-08-20/21
**Run:** `benchmarks/runs/2026-08-20-clique-local-main-sol-high/`
**Lane:** GPT-5.6 Sol high, Clique M1–M3, `snapback-familiar-ts-v1`
**Backend:** local source commit `708e2e5c5348b5bb863cd7120afbafad9db99e9a`
**Outcome:** M1–M3 green in 6,108s; 151,212 output tokens

This is N=1 diagnostic evidence against unpublished source, not scored or
claim-eligible. The lane agent's complete diary, essay, receipts, and report
remain under `/Users/ccheever/clique-main-20260820/` on the run machine.

## M1 — accounts and profiles

The Familiar constructors made validation, reads, writes, auth, and handlers
feel like ordinary TypeScript. Once generated references existed, profile
authoring was compact and the final live observations were about 185–354ms.
Familiar reached M1 green in 18:32, materially faster than this run's Explicit
M1.

The surrounding Snapback concepts did not disappear: sessions activation,
binding admission, durable custody, auth-context settlement identity, and
generated-reference discipline still had to be understood. Raw `start/load`
correctly refused sessions v1, managed development had no surfaced backend-port
flag, and the fixed UI-kit symlink needed Metro peer resolution. The CLI's
password response also prefixed recovery-code custody text before its JSON.

The clearest product drift appeared immediately. The Familiar Guide says a
point query can return `v.union([v.doc(...), v.null()])`, but current lowering
explicitly refuses it and directs authors to a one-row array. Later, a closed
object live query failed with the same value-result restriction. The lane had
to encode singleton results as bounded relational arrays.

## M2 — social feed

Ordinary set-state mutations were pleasant, and the backend generation for the
expanded social schema passed on the first attempt. The final suite was 22/22;
the final live post trials were a steady 1,356–1,365ms.

The expensive finding was subscription composition. Six independent live
queries per route looked reasonable and were far below the advertised
per-connection ceiling, but repeated two-client trials became unstable: an own
post exceeded the 15s observation window, interactive writes hit
`SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED`, and separately materialized social
sets disagreed transiently. Consolidating users, posts, follows, likes, and
reposts into one bounded singleton live query removed the contention and made
every retained trial green. This needs a minimized runtime/client reproduction;
it should not be dismissed as ordinary app tuning yet.

Familiar made the consolidation local, but the Guide needs a result-shape
matrix, a rule of thumb for query fan-out versus relational composition, and
an explicit user-mutation pattern for transient authorization suspension. The
generated hook boundary also lost useful inference in a few call sites, so the
lane had to annotate generated rows and narrow mutation results manually.

## M3 — messaging and typing

Normal query/mutation code remained readable, and generated nominal IDs caught
several private-roster mistakes at compile time. The completed lane passed
7/7 suite checks, all three DM trials at 821–840ms, all three typing trials at
1,669–1,694ms visible with 3,326–3,343ms withdrawal, and all quote-jump trials.

Authority modeling was the hard part. Generic membership-table writes were
correctly refused; the working path used generated bootstrap and transition
methods. Private membership rows could not double as a presentation roster,
and an owner-stamped inbox table could not be authored for other principals,
so the lane separated canonical private authority from a function-scoped inbox
projection. That projection currently has public-read storage posture and is
only narrowed by its app function, which is an honest production hardening gap.

The relevant scoped-role and typing pages contained the architecture, but the
path was fragmented. The Familiar entrypoint does not export the ephemeral
constructor; the bootstrap example did not close incidental-field behavior;
and the Familiar page's documented `resourceField: "_id"` was rejected by its
own TypeScript surface. Stable fixture identity also had to be separated from
`clientMutationId`, because a settled transport ID is bound to the auth context
that created it and refuses under a successor sign-in.

Compared with Convex, Familiar is competitive for ordinary colocated functions
and live hooks. It becomes distinctly Snapback-specific at custody, precise
result carriers, permission-backing membership, and ephemeral authorization.
The capability is there; the shortest supported composition across those
surfaces is not yet obvious enough.
