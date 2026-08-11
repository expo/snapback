# Diary 0074 — Pointing Room disclosure and keyed rooms

**Date:** 2026-08-10 · **Demo:** `demos/pointing-room` · **Surface:**
Exact/Contract web, Snapback sessions + live queries + ephemeral presence

## Slice 1 — cross-table disclosure

Pointing Room was built to force a privacy rule that row ownership cannot
express: another participant's vote is secret while a field on the current
round is false, then every vote becomes visible together when that field
changes. The useful result is that Snapback's inline JS live-query path could
state this directly. `liveTally` reads both tables and returns closed computed
records with `value: string | null`; codegen preserved that nullable type into
the generated Contract binding without coaxing.

The strongest part of the experience was the proof loop. Two real email-session
principals were cheap to mint with the repository harness, and wrapping B's
fetch/WebSocket transports made it possible to assert the actual bytes: A's
`13` was `null` for B before reveal and `"13"` afterward. A could see its own
card throughout, a second reveal was harmless, and a late B vote was refused as
`ROUND_REVEALED`. This is a better security story than a React component hiding
a prop it already received, and materially clearer than composing the same
cross-table rule from Supabase RLS policies or a client-side join. A Convex
server query could express the computation comparably, but the explicit
`reads:` set and generated nullable result contract made the dependency and
wire shape unusually reviewable here.

Contract was pleasant for the screen skeleton: loading/empty/ready branches,
generated live resources, mutations, and test IDs fit in one short file. It
also caught a real observability mismatch when `startRound` initially claimed a
write to `rooms` that the component did not read. The eventual model is cleaner:
one structural room fixture and a mutation that writes only `rounds`.

Contract also fought the core claim. The current invariant grammar can only
wrap `has`, `missing`, `count`, and element-state assertions. It cannot say
“for every tally row, this node's text equals `vote.value ?? '?'`,” nor can it
assert per-item field provenance. The nearest honest formulation partitions
the query by nullability, continuously checks masked/revealed node counts, and
uses mutually exclusive view branches so only null emits literal `?` and only
non-null emits the server value. That is useful UI-side evidence, but it is not
the same strength as the raw two-principal wire proof. A React test would be
more verbose but could make the exact text equality assertion easily.

Presence exposed another seam. Subscription was declarative, but publishing
ordinary `{name, picking}` presence was not shown by the adapter guide or demo
corpus, so this slice concluded it was not expressible as a Contract action and
drove the heartbeat and card-pointer bridge imperatively from `main.ts`.

> **Corrected in Slice 2.** That conclusion was wrong. The generated
> `roomPresence.publish.ts` descriptor composes with a Contract `pointerChannel`,
> a mount-time `publish(...)` task, and an explicit rate/heartbeat; Slice 2
> deleted the host bridge entirely. What is real here is the *guide* gap, not a
> Contract limitation — the paved path exists and the documentation does not
> reach it (`issues/20260810-guide-gap-contract-native-presence-publishing.md`).
> Recorded rather than rewritten, because the wrong turn is the finding: an
> author following the documented path lands on host glue and believes it is the
> answer.

Guide gaps encountered:

- The required sessions page did not show the safe Vite/browser mailbox relay;
  `demos/file-drop` source supplied the pattern that keeps admin and
  impersonation carriers out of browser code.
- The Contract adapter page described generated ephemeral links but did not
  show normal collection publishing from a Contract surface.
- The adapter page and checked-in demo corpus did not document the available
  `invariant` grammar; Exact package parser/tests were necessary to discover its
  limits.

These are filed as `guide-gap` tickets per AGENTS.md, together with the keyed
surface's missing ephemeral links found in Slice 2:

- `issues/20260810-guide-gap-browser-sessions-mailbox-relay-for-contract.md`
- `issues/20260810-guide-gap-contract-native-presence-publishing.md`
- `issues/20260810-guide-gap-contract-invariant-grammar-limits.md`
- `issues/closed/20260810-guide-gap-keyed-contract-surface-omits-ephemeral-links.md`

Browser verification had the ugliest infrastructure loop. Direct headless
Chrome aborted in macOS application registration on the primary Mac; its
LaunchServices fallback then falsely said the present executable was missing.
The project fleet guidance paid off: the same acceptance runner passed on the
MacBook Air, exercised sign-in, presence, round creation, and vote rendering,
then closed Chrome over CDP before profile cleanup. The demo copy was moved out
of that checkout afterward, leaving its unrelated work intact.

Overall: Snapback made the server-side invariant and its byte-level proof the
easy part. Exact made the ordinary screen compact and strongly wired, but its
current contract language is not yet rich enough to state this disclosure
claim with the same precision as the server result contract.

## Slice 2 — room-scoped keyed queries

The second slice removed the demo's global-latest shortcut. Planning and
Platform are now separate seeded rooms; `liveRound({ roomId })` uses
`by_room_sequence`, and `liveTally({ roomId })` follows the same room predicate
before reading votes through `by_room_round`. The computed tally adds safe
`roomId` and `roundId` provenance while retaining the Slice 1 rule verbatim:
only a revealed round or the caller's own row releases the stored value;
every other value remains `null`. `votes` remains deliberately unsyncable.

The Contract part answered the main question positively. `activeRoomId` is
ordinary component state, and both query initializers read it directly:
`liveRound({ roomId: activeRoomId })` and
`liveTally({ roomId: activeRoomId })`. Pressing a room button updates that state;
the Exact keyed runtime disposes the two predecessor logical bindings and opens
two successors without a remount or a host-side switch listener. This was
genuinely expressible in Contract. The browser acceptance observed three
disjoint pairs of server subscription IDs for Planning → Platform → Planning,
and the visible tally moved `5` → empty → `8` → `5` with the matching topics.

The boot requirement was more particular than the syntax. The original
surface pinned Exact 0.1.2, which the Snapback guide correctly identifies as
predating `rotatePartition`; moving the three Exact packages to 0.1.6 was
mandatory. The coordinated sessions surface then needed live push, descriptor
allowlisting through `liveQueries`, `requiredQueries`, no retained store, and
`keyedQueryScopes: true`. The guide showed those requirements accurately.

Presence exposed a narrower integration gap. Its Contract initializer can also
read `activeRoomId`, and the generated publish descriptor can now be driven by
a Contract-owned rated channel: a mount task announces presence, room changes
request a new publication, and a 0.1 Hz heartbeat keeps the active entry alive.
That removed Slice 1's DOM event/timer publisher glue. However, the full keyed
Snapback surface currently returns durable keyed query/mutation links but omits
generated ephemeral links entirely. Boot therefore creates a second
ephemeral-only surface and merges that missing link family before mounting.
So presence re-scoping is declarative in the component, but its provider boot
still needs host composition. Calling the whole path Contract-native would be
misleading.

The raw acceptance now proves the security property across rooms, not merely
inside one. Grace subscribes to Planning after Ada's `13`; the captured HTTP
snapshot contains Planning provenance and explicit `value:null`. Ada then
casts `8` in Platform. Neither the Platform room id nor `"value":"8"` appears
in any Planning response/frame, and Grace's Planning row stays masked. Revealing
Planning later delivers `"13"` on the same wire subscription. This is stronger
than checking a rendered list after client filtering.

Compared with React, Contract makes the room selection and three reactive
bindings unusually compact, and Exact owns canonical key identity, dedup,
refcounts, and predecessor fencing rather than leaving hook lifecycle details
to the app. A React/Convex `useQuery(api.tally, { roomId })` would be equally
easy to write at the call site, though its subscription teardown proof would
still live in client/runtime tests. Supabase would require more explicit
channel/filter composition, and keeping a cross-table reveal policy from
leaking raw vote rows would remain the harder part.

Slice 2 took about fourteen minutes through the current-source browser pass:
one orientation/reference pass, one schema/codegen/Contract build pass, one
wire-test pass, and two browser launch lanes. Codegen reported zero warnings.
The local browser lane repeated the Slice 1 LaunchServices failure verbatim:

```text
Error: Chrome exited before CDP startup (1):
The application cannot be opened for an unexpected reason, error=Error Domain=NSOSStatusErrorDomain Code=-10827 "kLSNoExecutableErr: The executable is missing" UserInfo={_LSLine=4277, _LSFunction=_LSOpenStuffCallLocal, _LSFile=LSOpenCore.mm, _LSErrorMessage=kLSNoExecutableErr}
```

The unchanged browser runner passed on the MacBook Air. Both local server
launches also repeated the explicit prebuilt identity warning from Slice 1;
that remains provenance noise forced by the charter's no-rebuild constraint,
not a passing-test substitution. The remote demo copy was moved intact to a
temporary recovery directory after the pass.

## Slice 3 — one keyed surface owns presence too

The product fix removed the one piece of host composition left by Slice 2.
`createSnapbackContractSurface({ keyedQueryScopes: true })` now builds the same
swappable ephemeral wiring as the multi-live surface, returns the generated
`roomPresence` and `roomPresencePublish` links beside `liveRound` and
`liveTally`, and refuses during boot when the client cannot serve a declared
ephemeral collection. Pointing Room consequently boots one surface, prewarms
the Planning room on it, and configures the generated registry from that one
link object.

This is the shape the guide had led the build to expect: keyed durable scopes
and ephemeral presence are independent binding kinds, not independent provider
boots. Compared with React plus Convex or Supabase, the important gain is less
about fewer lines than about one authority lifecycle: quiesce blanks the
mounted presence map, successor wiring prewarms behind the barrier, and only a
fenced commit exposes it. The remaining deliberate limitation is provider-side
`forceEphemeralState` for keyed mode; ordinary read/publish operation and
authority swapping no longer need a companion surface.

## Slice 4 — declared field boundary (2026-08-11)

The disclosure rule now has an author-facing review surface as well as a
handler and a two-principal acceptance proof. `liveTally` declares that
`value` is concealed until the round is revealed or the caller owns the vote;
codegen checks the declared field against the result contract, carries the
claim into the function manifest, and labels it in the committed summary as
handler-enforced and not proven. That label matters: the declaration makes an
opaque JavaScript rule reviewable, but does not turn free text into policy or
noninterference proof.

The shape was pleasantly small compared with reconstructing the same intent
from a Convex handler review or a Supabase policy plus join analysis. The
strong evidence still comes from the acceptance test: it reads the declaration
from the generated manifest and uses two authenticated principals to prove
that the owner sees `13` while the non-owner sees `null`, then that both see
`13` after reveal. The main friction was environmental rather than authoring:
the chartered Lane B binary's readiness receipt had drifted, so verification
needed a current-tree temporary binary and a fresh coherent receipt.
