# Removed member's open live client still receives post-removal group messages (Familiar arm, capstone)

**Status:** Closed
**Opened:** 2026-08-25
**Closed:** 2026-08-25
**Systems:** Familiar, Live queries, Auth
**Related:** `benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/`
(cell 2), LLP 0281 (cutoff assertion), LLP 0234 (roster governance),
`issues/20260820-familiar-live-subscription-contention.md` (adjacent, distinct)

## Problem

In the capstone run's Familiar cell (published 0.1.27, sol-high builder),
the frozen `0.3.4-m8` choreography's
`member-add-promote-remove-leave-and-live-cutoff` failed repeatably: after
a member was removed from a group, that member's **already-open** client
still observed a group message sent after the removal. The builder spent
73 minutes across 29 correction loops trying to enforce the cutoff from
the application side and recorded M3 `aborted` (suite was 7/7 green — the
leak is only visible to the two-client live choreography). Everything
downstream was dependency-blocked, so the Familiar arm terminated at M3.

Evidence: `lanes/familiar/final-report.md` + `run-log.md` + choreography
receipts under the campaign root on `expo-build-450b`
(`/home/ccheever/capstone-0127-20260825/`).

## Why this matters

- The 0.1.25 baseline's Familiar arm went M3-green under the old
  instrument, whose cutoff check was a fixed 500 ms sleep — that green is
  now suspect as a false green on the same behavior. The strengthened
  delivery-progress-bounded assertion (E4 fix round) is what caught it.
- The shape matches the known membership/live-query governance territory:
  a membership revocation must fence deliveries to already-open live
  subscriptions, not just gate new reads. Class R made reads fail-closed
  under roster governance; this is the live-delivery half of that story
  for the Familiar profile.

## Wanted

- Root-cause which layer leaks: does the Familiar profile's live
  subscription re-evaluate membership on roster change (server-side fence),
  or is post-removal delivery to open subscriptions expected and the app
  required to fence (in which case the guide must say exactly how, and the
  capstone builder's 73-minute failure to find that path is a guide gap)?
- A regression at the product level (not just the benchmark choreography):
  removed member with an open live subscription must not observe
  post-removal messages, or must observably transition to a refused/closed
  subscription state.
- Reconcile with LLP 0234 roster governance and the 20260820 contention
  ticket's Wanted #4 acceptance bar where they intersect.

## Root-cause classification — 2026-08-25

**Classification: (b).** The capstone application did not use Snapback's
membership authority or declare its hand-written roster as permission backing.
Its `memberships` and `messages` tables were both `public-read` + `sync()`, and
removal was an ordinary `ctx.db.patch(..., { active: false, removedAt })`.
Consequently the removal receipt carried no authorization transition and the
platform contract left cutoff coordination to the application. The application
then tried to compose an imperative server filter, a separately delivered
`myMemberships` query, and a browser-clock/BroadcastChannel cutoff. That is not
an LLP 0053/0200 revocation fence.

The server-side Class R mechanism is present and works when authority is
declared. A control using a Familiar `.membership()` roster observed
`global-authorization-epoch-advanced`, an immediate
`authorization_quarantine`, a replacement containing no rows, and no
post-removal sentinel. The owner subscription received the sentinel, proving
data-lane progress. This rules out classification (a).

A minimized app matching the capstone's actual public-sync/imperative shape
was then run on current main through two authenticated clients, generated API
references, stream transport, and a headless Familiar React provider. B's open
subscription retained `before-removal`; owner removed B and immediately sent
`after-removal-sentinel`; a fresh B query returned only `before-removal`; and
neither B's raw update transcript nor its Familiar hook frames ever contained
the sentinel. The generated function declared reads of `memberships` and
`messages`, and every post-write handler result was reevaluated rather than
bypassed. This rules out classification (c) on current main and localizes the
published benchmark observation to the application's undeclared-authority,
multi-subscription/browser-clock fence rather than a server delivery bypass.

The product gap is discoverability and admission. A hand-written
`permissionBacking(fields)` roster would create the needed epoch fence, but
LLP 0274 correctly makes generic application writes to authority tables
ineligible; applying that declaration to the capstone app fails generation
with `SNAPBACK_TABLE_WRITE_AUTHORITY_TABLE_INELIGIBLE`. The compatible paved
path is a real `.membership()`/`authorityProfile()` roster whose removal is an
active delivery role → non-delivery `former` role transition. Keeping the row
lets a retained-history query remain admitted while an ordinary access-window
row supplies its persisted cutoff; the role transition remains the
host-checked authorization event and revocation fence. The
served guide did not name this pattern, connect the generic-write refusal to
it, or state that public visibility does not create a revocation fence. A
strong agent therefore spent 73 minutes attempting an application-side
substitute for an available but undiscoverable composition.

## Resolution shipped — 2026-08-25

The Familiar paved path now names the declaration boundary and the compatible
retained-history composition: record an ordinary server-timestamped access
cutoff, transition the generated membership profile from `member` to the
non-delivery active role `former`, then admit later sends only after that
transition settles. The membership commit is the LLP 0200 fence; the ordinary
cutoff lets the restored query retain only earlier rows. Generated `remove`
remains the simpler blank-all-history path.

`SNAPBACK_TABLE_WRITE_AUTHORITY_TABLE_INELIGIBLE` now carries repair class
`use-generated-membership-authority-operation` and routes directly to the new
guide section. This makes the capstone's tempting `permissionBacking()` plus
generic-writer dead end actionable without weakening LLP 0274's refusal.

`tests/acceptance/familiar-removed-member-live-cutoff.mjs` is the packed
product regression. Its first phase proves that the capstone-shaped authority
writer refuses with the new route (the assertion fails on the pre-fix tree).
Its two authenticated clients then use generated API references, a real local
server, stream delivery, and a headless Familiar React provider. After the
owner records the cutoff and receives a
`global-authorization-epoch-advanced` role-transition settlement, it sends the
sentinel immediately—without waiting for B's quarantine callback. B's raw and
React transcripts cross `authorization_quarantine`, restore
`before-removal`, and never contain the sentinel; the owner's open subscription
receives it and proves delivery progress.

LLP 0200 §2.4 now records that the fence is declaration-bound and that a data
commit ordered after the generated transition cannot deliver under the prior
authorization epoch. Retrieval case 98 pins the intent vocabulary and rejects
the public-roster/browser-clock anti-pattern. The two-step cutoff + transition
is disclosure-safe but not an atomic availability transaction: a successful
cutoff followed by a failed role change can hide data early until retry or
repair. Atomic arbitrary companion writes with a principal-addressed generated
transition remain outside the current surface and were not invented here.
