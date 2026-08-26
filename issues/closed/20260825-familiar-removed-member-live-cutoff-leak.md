# Removed member's open live client still receives post-removal group messages (Familiar arm, capstone)

**Status:** Closed
**Opened:** 2026-08-25
**Closed:** 2026-08-25
**Systems:** Familiar, Live queries, Auth
**Related:** `benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/`
(cell 2), LLP 0281 (cutoff assertion), LLP 0234 (visibility-override governance),
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
- Reconcile with LLP 0234 visibility-override governance and the 20260820
  contention ticket's Wanted #4 acceptance bar where they intersect.

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

The packed regression runs two undeclared legs over an ordinary `public-read` +
`sync()` `roomMemberships` table and a generic patch from `active: true` to
`active: false`. The safer leg uses one authenticated live handler whose
generated read set is exactly `roomMemberships + messages`. The removed
client's post-sentinel callback (framed after its removal reevaluation, not a
pre-existing handle value) and fresh read both retain only `before-removal`;
the owner observes the sentinel; the removal receipt has no authority
transition; and the server's fence count does not change. Its persisted
server-time cutoff and messages share one reevaluated read set.

The second leg reproduces the capstone's split composition. A messages-only
authenticated query reads only the `public-read` messages table, while an
independent membership query reads only `roomMemberships`; browser-cutoff logic
composes the separately delivered values client-side. The membership stream is
guaranteed and observed to reach `active: false`. The messages stream is also
guaranteed and observed to contain the post-removal sentinel, because that
undeclared data-lane query has no roster or authorization dependence. The
transcript records whether callback order paints the sentinel in the composed
view, but does not assert either outcome: Snapback provides no cross-stream
order here, so that race is application-owned.

This reproduction is the evidence-backed explanation of the capstone bubble.
It supports classification (b) without dismissing the observation or
pretending the safer same-handler leg covered the application graph that
failed. What Snapback guarantees in the split leg is each stream's own result;
what it does not guarantee is an authorization fence or a security ordering
between those independently delivered ordinary-data facts.

The declared control separates the application cutoff from the platform
gate. Its retained-history query still uses the ordinary cutoff, but a second
`hasRole('member')` live query has no cutoff table and no handler filter. The
open control receives a message committed under the predecessor role, crosses
`authorization_quarantine` after the generated `member` → `former`
transition, and restores to an empty current result; a fresh read is also
empty. The owner receives both the pre-transition and post-transition
sentinels, proving continued publication. Separately,
`crates/snapback-sync/tests/live_authority_gate.rs` installs successor epoch 8
and asserts that an epoch-7 frame is discarded, leaves the subscription stale,
and cannot restore it; only an epoch-8 proof restores delivery. The engine test
`engine_authorization_snapshot_path_discards_predecessor_after_installed_fence`
then evaluates a real auth-scoped snapshot under the predecessor epoch,
installs the successor through `apply_live_authority_fences`, and drives that
stale snapshot through production `deliver_authorization_snapshot` →
`authorize_live_delivery`. It must return before enqueue and leave restoration
owed. Omitting the production fence installation or bypassing the wrapper gate
therefore fails coverage independently of application filtering or race timing.
Together these facts rule out classification (a).

The product gap was discoverability and admission. Codegen now emits
`SNAPBACK_ORDINARY_ROSTER_AUTHORITY_UNDECLARED` only on a narrower,
statically provable same-handler source. The advisory deliberately does not
claim to detect the split capstone graph because backend codegen has no client
composition artifact. It requires a public-sync table with
principal/resource/lifecycle schema axes, an exact generic lifecycle
patch/delete, and one authenticated multi-table handler where the exact roster
read is current-principal-scoped and its lifecycle field controls another
table's result. A real multi-table display query that independently reads auth,
displays roster lifecycle state, and filters messages is the semantic negative
control. The repair points finite role rosters to
`.membership()`/`.authorityProfile()` and generated transitions; it does not
claim that an ordinary data patch is already a fence.

`permissionBacking(fields)` remains a different authority class. LLP 0274
correctly makes generic application writes to authority tables ineligible and
generation reports `SNAPBACK_TABLE_WRITE_AUTHORITY_TABLE_INELIGIBLE`. Its
repair now says to use that declaration's own governed writer; migration to a
membership profile is suggested only when the relation really is a finite
principal/resource role roster. Broader permission-backing models are not
told to become memberships. For the capstone roster, the compatible paved
path is a real membership profile whose removal is an active delivery role →
non-delivery `former` transition, with an ordinary access-window row supplying
the retained-history cutoff.

## Resolution shipped — 2026-08-25

The Familiar paved path now names the declaration boundary and the compatible
retained-history composition: record an ordinary server-timestamped access
cutoff, transition the generated membership profile from `member` to the
non-delivery active role `former`, then admit later sends only after that
transition settles. The membership commit is the LLP 0200 fence; the ordinary
cutoff lets the restored query retain only earlier rows. Generated `remove`
remains the simpler blank-all-history path.

Codegen now steers both relevant failure modes. The conservative
`SNAPBACK_ORDINARY_ROSTER_AUTHORITY_UNDECLARED` warning fires on the provable
same-handler roster/result-gate shape and points to the recipe. It explicitly
does not claim split-client-graph coverage; the packed characterization and
guide text own that explanation. Neither a single-table display nor the real
multi-table display negative control warns.
`SNAPBACK_TABLE_WRITE_AUTHORITY_TABLE_INELIGIBLE` retains repair class
`use-generated-membership-authority-operation` and the same guide route, but
its advice is authority-class-specific: membership tables use their generated
profile transitions; permission-backing tables use their own governed writer
unless their model is genuinely the finite role-roster shape.

`tests/acceptance/familiar-removed-member-live-cutoff.mjs` is the packed
product regression. Its first server phase characterizes both undeclared
forms: the safer true two-table read set, and the capstone-faithful independent
membership/messages streams composed with a browser cutoff. It asserts the
same-handler advisory's exact scope, membership removal on its own stream, and
the sentinel on the messages-only stream; the client composition order remains
record-only. Its declared leg uses generated API references, a real local
server, stream delivery, and a headless Familiar React provider. The no-cutoff
role-gated control isolates authority admission from the history filter. After
the owner records the cutoff and receives a
`global-authorization-epoch-advanced` role-transition settlement, it sends the
post-transition sentinel immediately—without waiting for B's callback. Raw
stream state observes `authorization_quarantine`; Familiar `useQuery` becomes
`undefined` at that boundary, then restores `before-removal` with
ready/current/live state. Post-transition frames are published, the owner sees
both sentinels, and neither B surface sees either forbidden sentinel after the
transition. The coalescer unit plus engine production-wrapper test pin
predecessor-frame rejection without relying on a scheduler race.

LLP 0200 §2.4 now records that the fence is declaration-bound and that a data
commit ordered after the generated transition cannot deliver under the prior
authorization epoch. Retrieval case 98 pins the intent vocabulary and rejects
the public-roster/browser-clock anti-pattern. The two-step cutoff + transition
is disclosure-safe but not an atomic availability transaction: a successful
cutoff followed by a failed role change can hide data early until retry or
repair. Atomic arbitrary companion writes with a principal-addressed generated
transition remain outside the current surface and were not invented here.

The 20260820 contention ticket's Wanted #4 does not close here. That ticket
requires a client-visible diagnostic *before* a multi-subscription UI becomes
inconsistent or suspended. This lane observes and documents the established
authorization-boundary lifecycle after a declared transition; it neither
implements a pre-inconsistency overload warning nor changes LLP 0200's
scheduler-capacity contract. The contention ticket therefore remains open and
owns that distinct exit condition.

**Engine-test execution caveat (2026-08-25):** the epoch-gate delivery test
compiles clean but cannot yet execute — the engine lib-test target is red
on main from inherited seam-helper debt
(`issues/20260825-engine-lib-test-target-red-seam-helpers.md`). The
coalescer unit test and the packed two-client legs carry the executable
proof until that clears.
