# LLP 0180: Asset-bearing client commands

**Type:** RFC
**Status:** Accepted
**Systems:** Assets, Client integration, Mutations, Auth, React/Expo, Code
generation, Protocol, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-05
**Revised:** 2026-08-06 (e) — Accepted by the author (Charlie Cheever,
LLP 0176 G1 gate). Per §React projection, this acceptance amends LLP 0114
to add `useSnapbackCommand` as a named projection with the same
lifecycle/cleanup discipline as `useSnapbackMutation`; the corresponding
dated amendment is recorded in LLP 0114's own header and §Named
projections from accepted RFCs. Implementation remains LLP 0176 G3
delivery work.
2026-08-05 (d) — Super-refine round 2 (delta): fixed a
self-defeating terminal-state rule that tied a task's `.done` settlement to
the act of retrying it, which would leave an un-retried failed task's
`.done` unsettled forever — settlement now happens the instant a task
reaches its terminal status, independent of `retry()`; added an explicit
`CommandOutcome.kind` ↔ `CommandTaskSnapshot.status` mapping; and stated
`useSnapbackCommand`'s own LLP 0114 amendment here instead of leaving it
implied by LLP 0179. 2026-08-05 (c) — Super-refine round 1: gave `.done` a
distinguished rejection type for `ambiguous` so an unsettled command cannot
collapse into an ordinary rejection a caller's `catch` would read as "failed,
safe to resend" (a reviewer traced this to a concrete duplicate-send
scenario); typed residue with explicit `authoritative | inferred | unknown`
provenance instead of an opaque `CommandResidue`; added a terminal-state
transition table covering retry generations and what happens to a
predecessor `.done` when a `failed` task is retried; and stated the
`defineCommand` input-derivation rule (mutation args minus the
asset-mapped argument) explicitly instead of leaving it implicit in the
example. 2026-08-05 (b) — Narrowed v1 to one online client composition
using the existing ordinary session, one asset, and one mutation; removed
attempt grants, durable restart, offline custody, and multi-asset commands from
the critical path; and made the command a node of LLP 0179's single
`AppDescriptor`.
**Related:** LLP 0004, LLP 0012, LLP 0039, LLP 0043, LLP 0044, LLP 0053, LLP
0055, LLP 0064, LLP 0107, LLP 0114, LLP 0133, LLP 0157, LLP 0176, LLP 0179,
LLP 0181

## Summary

Sending an image message is one product action but currently requires
application code to:

1. normalize an Expo picker/content URI;
2. start and observe an asset upload task;
3. wait for a finalized typed asset reference;
4. invoke a separate mutation with that reference; and
5. reconcile cancellation, retry, ambiguous mutation settlement, and a
   finalized-but-unattached asset.

The asset and database commit must remain separate trust and failure
boundaries. The application should not have to rebuild their coordinator.

This RFC defines a bounded **asset-bearing client command**: one generated,
language-neutral recipe composing at most one declared asset input with one
ordinary mutation. The client exposes it as one task whose state is derived
from the existing asset task and mutation-attempt facts.

V1 is intentionally small:

- online execution only;
- transient source custody only;
- zero or one asset input;
- exactly one ordinary mutation;
- the existing ordinary application session on every authorized step; and
- no new server endpoint or credential class.

This is enough to make the common image-send path one typed call without
claiming a workflow engine, distributed transaction, restart recovery, offline
send, or anonymous upload.

## Authority and scope

This RFC owns:

- the closed client-command descriptor;
- composition order and the mutation commit boundary;
- the command task's derived state and result;
- retry, cancellation, ambiguity, and residue semantics for the bounded v1;
  and
- headless/React projection of the command.

It does not own:

- asset intent, policy, attempt, transfer, attachment, delivery, processing,
  cleanup, or authorization semantics (LLP 0044);
- mutation invocation, identity, settlement, optimistic state, or canonical
  attempt storage (existing mutation/client owners and LLP 0114);
- ordinary session or guest principal semantics (LLP 0055 and auth owners);
- durable/offline source or settlement custody (LLP 0043);
- the stable app namespace (LLP 0179); or
- picker/content-URI adapters and Expo lifecycle (LLP 0181).

A command is client composition. It does not become a server transaction and
does not introduce a command endpoint.

This RFC stays a separate document from LLP 0179 despite a command being a
node inside LLP 0179's `AppDescriptor` and the two shipping in lockstep — see
LLP 0176's explicit reasoning for keeping the two split (declaration-time
failure modes versus this RFC's cross-trust-boundary execution failure
modes) rather than re-litigating it here.

## Baseline authority fact

The existing asset client forwards the ordinary session bearer on reservation
and TUS requests when a credential is present. The reproduced LLP 0176 failure
was the tested development client reaching upload without that session and
therefore resolving as anonymous while the asset owner required a principal.

V1 fixes that path by giving the application an ordinary paired guest/dev or
signed-in session through LLP 0181. An attempt grant cannot manufacture the
missing principal and is not required to prove the ergonomic win.

## Declaration

A command is authored beside the generated operations it composes:

```ts
export const sendMessage = defineMutation({
  args: {
    conversationId: v.id("conversations"),
    body: v.optional(v.string()),
    image: v.optional(v.assetRef({ upload: messageImageUpload })),
  },
  // The ordinary mutation remains the only application-row commit.
})

export const send = defineCommand({
  mutation: sendMessage,
  assets: {
    image: {
      intent: messageImageUpload,
      optional: true,
      mutationArg: "image",
    },
  },
})
```

Codegen places the portable command descriptor at `app.commands.send` in LLP
0179's `AppDescriptor`. A surface may bind `conversationId` and expose it
as `app.surfaces.conversation.commands.send`.

**Input-derivation rule.** `defineCommand` declares no separate input list;
the command's call signature is derived mechanically: every mutation
argument becomes a command input *except* the one argument named by
`assets.<key>.mutationArg` (here, `image`), which the command supplies from
the asset upload's result instead. The asset's own input name in the
generated call (here, also `image`, taken from the `assets` map's key) is
therefore a distinct slot from the mutation argument it feeds — generation
refuses if an asset key collides with the name of a *different*, still-open
mutation input, since that would make the derived call signature ambiguous
about which one a caller's `image` field means.

The descriptor contains reference identities and argument mappings, not
callbacks:

```ts
interface AssetBearingCommandDescriptorV1 {
  readonly kind: "asset-bearing-command.v1"
  readonly mutation: MutationReferenceIdentity
  readonly asset:
    | null
    | {
        readonly input: string
        readonly intent: AssetIntentReferenceIdentity
        readonly mutationArg: string
        readonly optional: boolean
      }
  readonly passthroughArgs: readonly string[]
}
```

Generation refuses:

- zero or more than one mutation;
- more than one asset input in v1;
- a mutation target that is not a compatible `assetRef` argument;
- an asset intent incompatible with that argument's declared upload policy;
- an input mapped twice or left ambiguously mapped;
- a required mutation argument with no command input/binding;
- callbacks, branches, loops, or arbitrary post-processing; and
- attempts to inject session/principal/admin authority as a command argument.

Text-only execution of an optional asset command is an admitted branch in the
closed descriptor: the asset child is absent and the same ordinary mutation is
called without that optional reference.

## Input and platform adapters

The headless command accepts the existing structural asset input supported by
the asset client. LLP 0181 may adapt an Expo picker/content URI to that input
using `expo/fetch`, Blob, or a stronger native adapter.

The command descriptor does not name Expo, a filesystem path, a Blob class, or
a platform library. Source normalization happens before the asset task starts
and reports whether the source is only transient. V1 refuses or clearly fails
when the source is no longer readable; it does not claim process-death resume.

## Execution

For an image-bearing invocation the client:

1. validates command input and current binding/session compatibility;
2. starts the existing asset task using the declared intent and ordinary
   application session;
3. awaits the existing task's finalized typed asset reference;
4. invokes the ordinary mutation once with the same command arguments plus
   that reference; and
5. resolves from the mutation's existing settlement/result facts.

For text-only invocation, step 2–3 are absent.

The mutation remains the sole application commit. Its handler performs the
existing commit-bound attachment/authorization check. Finalizing bytes does
not create a message, and a command task cannot claim otherwise.

The command does not wait for every asynchronous asset processing derivative
unless the declared mutation/asset contract already requires readiness.
Success reports both commit and current processing/readiness facts so the view
can render honestly.

## Command task

Starting a command returns a stable task:

```ts
interface CommandTask<Result> {
  readonly id: string
  readonly generation: number
  snapshot(): CommandTaskSnapshot<Result>
  subscribe(listener: () => void): () => void
  cancel(): Promise<void>
  retry(): CommandTask<Result>
  readonly done: Promise<CommandOutcome<Result>>
}
```

A round-2 delta review correctly found the type had not been updated to
match §Terminal-state transitions below: `retry()` returns the new
successor task synchronously — the same shape starting a command already
returns (`const task = chat.commands.send(...)`, no `await`) — not a
`Promise<void>`. The successor's own `.done` is, as always, a promise; the
synchronous return is the task object, not its settlement.

`.done` is not a bare `Promise<Result>`. A reviewer traced a concrete failure
scenario in the earlier shape: a two-state promise (resolve or reject) forces
`ambiguous` to be represented as a rejection, so a caller's ordinary
`catch (err) { showFailed() }` reads an unsettled send as a failure, the user
resends, and — if the server had in fact committed the first attempt — the
result is a duplicate message from exactly the confusion this command exists
to prevent. `.done` therefore resolves to a discriminated `CommandOutcome`
rather than rejecting on anything but a genuine local/programmer error
(invalid arguments, an unreadable source before any network step):

```ts
type CommandOutcome<Result> =
  | { kind: "committed"; result: Result }
  | { kind: "failed"; diagnostic: SnapbackDiagnostic;
      residue: CommandResidue | null; repairs: readonly TypedRemediation[] }
  | { kind: "cancelled" }
  | { kind: "ambiguous"; diagnostic: SnapbackDiagnostic;
      residue: CommandResidue | null; repairs: readonly TypedRemediation[] }
  | { kind: "notRetryable"; diagnostic: SnapbackDiagnostic }
```

`CommandOutcome.kind` and `CommandTaskSnapshot.status` are deliberately
distinct vocabularies for distinct purposes — `kind` names a settled result,
`status` names a point-in-time state including the non-terminal ones
(`preparing`, `transferring`, `committing`) `CommandOutcome` has no use for
— but "agree" (§Acceptance) means this exact fixed mapping, stated once so a
test can assert it directly rather than infer it: `succeeded → committed`,
`failed → failed`, `cancelled → cancelled`, `ambiguous → ambiguous`.
`notRetryable` has no corresponding snapshot `status` — it is a
`CommandOutcome`-only kind, returned exclusively by the task `retry()`
synchronously produces when called on an already-`succeeded` or
clean-`cancelled` predecessor (§Terminal-state transitions). A round-3
review correctly found the first version of this rule surfaced that case as
`kind: "failed"`, which a caller destructuring `{ kind }` would read as "the
send failed, safe to resend" — precisely the confusion this whole type
exists to prevent, reintroduced at the one seam meant to guard against it.

A caller that only wants the happy path still writes `await task.done`, but
an ordinary destructure (`const { kind } = await task.done`) surfaces
`ambiguous` and `failed` as distinct, separately-named values a caller must
actively choose to conflate — a materially harder accident than the prior
`reject`-based shape, where both collapsed into the same `catch` by
construction and no destructure could have separated them. This does not
make misuse impossible — nothing stops a caller from writing
`catch { showFailed() }` around the whole `await` and ignoring `kind`
entirely — but it removes the shape that made conflation the *default*
behavior of ordinary error handling.

The snapshot is a derived projection over existing children:

```ts
type CommandTaskSnapshot<Result> =
  | { status: "preparing"; asset: null; mutation: null }
  | { status: "transferring"; asset: AssetTaskSnapshot; mutation: null }
  | { status: "committing"; asset: AssetTaskSnapshot | null;
      mutation: MutationAttemptSnapshot }
  | { status: "succeeded"; result: Result;
      asset: AssetTaskSnapshot | null; residue: null }
  | { status: "failed" | "cancelled" | "ambiguous";
      diagnostic: SnapbackDiagnostic;
      asset: AssetTaskSnapshot | null;
      mutation: MutationAttemptSnapshot | null;
      residue: CommandResidue | null;
      repairs: readonly TypedRemediation[] }
```

`CommandResidue` carries explicit provenance rather than asserting a single
fact the command cannot always prove:

```ts
interface CommandResidue {
  readonly assetId: string
  readonly unattached: "authoritative" | "inferred" | "unknown"
  readonly basis: string
  readonly cleanupPolicy: string
}
```

`unattached: "authoritative"` requires LLP 0044 to expose a fact proving no
attachment exists anywhere for this asset id, not merely that *this*
mutation attempt did not attach it — a failed mutation on its own only
proves the latter. Until LLP 0044 exposes that stronger fact (tracked as an
open ask, not assumed here), the command reports `"inferred"` (a
same-session heuristic) or `"unknown"`, and the client must render these
three differently rather than treating any of them as "safe to delete."

The exact child type names follow their existing packages. The load-bearing
requirements are:

- the task does not copy child state into an independently authoritative
  store;
- every summary status is derivable from child facts;
- rich asset and mutation facts remain reachable;
- `.done` settles to a `CommandOutcome` consistent with the terminal
  snapshot's `status`, and only rejects for a local/programmer error that
  precedes any network step; and
- cleanup of the wrapper never cancels or discards a child contrary to its
  existing owner.

### Terminal-state transitions

Retrying a task does not reuse its identity silently — a reviewer correctly
asked what happens to a task's original `.done` when `retry()` is called
after `failed`, `ambiguous`, or a partial `cancelled`. A round-2 delta review
then correctly found the first answer to that question self-defeating: it
tied the *original* task's settlement to the *act of retrying*, which means
a task nobody ever retries would never settle — silently breaking the one
property `CommandOutcome` exists to guarantee ("a caller that only wants the
happy path still writes `await task.done`"). The corrected rule separates
settlement from retry entirely:

- **A task's `.done` settles the instant that task reaches a terminal
  snapshot status** (`succeeded`, `failed`, `cancelled`, or `ambiguous`) —
  independent of whether `retry()` is ever called. `await task.done` on a
  send that is never retried resolves to the matching `CommandOutcome` as
  soon as the terminal status is reached, exactly like any other settled
  promise.
- `retry()` is a separate action available from a task already in one of the
  retryable terminal states (`failed`, `ambiguous`, a partial `cancelled`).
  It does not reopen or affect the calling task's already-settled `.done` in
  any way — that task's outcome is history. `retry()` instead increments
  `generation` and returns a **new**, independent task object with its own
  fresh, unsettled `.done`.
- `subscribe` listeners attached to the predecessor are not silently
  migrated to the successor; a caller that wants to follow a retried command
  must observe the object `retry()` returns.
- `succeeded` and a clean `cancelled` (before any network step) are true
  terminals: `retry()` on either still returns a `CommandTask` (per its
  synchronous signature), but that task's `.done` settles immediately to
  `kind: "notRetryable"` — never `"failed"` (a round-3 review correctly
  flagged that spelling as recreating the exact conflation this type exists
  to prevent) and never a resubmission — succeeded already committed, and a
  clean cancel has nothing to resume.
- `ambiguous` is **not** a dead end: `retry()` is admitted, and per
  §Mutation ambiguity below it revalidates through the existing mutation
  identity rather than minting a new one, so a retried ambiguous command can
  still resolve to `committed` if the original attempt in fact succeeded.

## Failure, retry, cancellation, and residue

### Before finalization

An asset refusal or transfer failure means the mutation is not invoked. Retry
delegates to the existing asset task when it is safe and the transient source
still exists.

### After finalization, before mutation success

A mutation refusal can leave finalized but unattached bytes. The command
reports the `CommandResidue` shape defined in §Command task above — asset
id, `unattached` provenance (`authoritative | inferred | unknown`, never
overstated), the governing cleanup/expiry policy, and safe retry actions.
It does not silently delete the asset. Cleanup remains LLP 0044's decision.

### Mutation ambiguity

Once mutation invocation begins, retries reuse the existing mutation identity
and settlement machinery. A missing receipt or disconnected response is
`ambiguous` until the existing owner can prove success or refusal. The
command must never issue a fresh mutation identity merely to make `.done`
settle.

### Cancellation

Cancellation is phase-aware, and a round-3 review correctly found the
original two-case split conflated a clean cancellation with an unsettled
one under the same `kind: "cancelled"` outcome that carries no diagnostic
or residue field to say which:

- **Before mutation invocation** (still `preparing`/`transferring`): cancel
  the asset child where its current state permits, and settle
  `kind: "cancelled"` — this is the only case with no outstanding server
  interaction, so it is the only case that outcome kind may report.
- **After mutation invocation, before settlement** (`committing`):
  cancellation stops local interest but cannot claim the server commit was
  undone or never happened. This is **not** `kind: "cancelled"` — it settles
  `kind: "ambiguous"`, exactly like a missing receipt or disconnected
  response (§Mutation ambiguity), because from the client's own facts the
  two are indistinguishable: local interest stopped without proof of the
  server's outcome either way.
- **After success:** cancellation is a no-op or stable refusal, never
  compensation; the task is already `kind: "committed"`.

The terminal snapshot says what happened to each child.

## Authority and replacement

Every child uses the ordinary application session and the authorization rules
of its real subsystem. A command task records the authority cohort under which
it began.

If the provider replaces authority while a task is active:

- the task is not silently adopted by the successor principal;
- predecessor facts are hidden/fenced according to existing client rules;
- retries revalidate rather than changing effective principal; and
- the final mutation cannot attach an asset under a different principal unless
  LLP 0044 explicitly admits that transition.

Bound resource ids are also not authority. The mutation and asset intent each
authorize independently.

## React and surface projections

`useSnapbackCommand` is a framework-neutral `CommandTask`/`CommandOutcome`
composition projected through LLP 0114's existing React hook machinery, not
a competing React authority — LLP 0179 states the parallel amendment for
`useSurface`; this RFC states its own half here rather than leaving it
implied by a sibling document, per a round-2 reviewer's correct finding that
0179 cannot amend LLP 0114 on this RFC's behalf. Accepting this RFC amends
LLP 0114 to add `useSnapbackCommand` as a named projection using the same
lifecycle/cleanup discipline LLP 0114 already requires of
`useSnapbackMutation`. Until LLP 0114 accepts that amendment, this section's
React semantics are proposed, not settled — consistent with §Authority and
scope, which already lists "headless/React projection of the command" among
what this RFC owns as *framework-neutral* semantics, not as an independent
React authority.

The direct React hook is:

```tsx
const send = useSnapbackCommand(app.commands.send)
const task = send({ conversationId, body, image: picked })
const { kind } = await task.done
```

LLP 0179 may bind `conversationId`:

```tsx
const chat = useSurface(app.surfaces.conversation, { conversationId })
const task = chat.commands.send({ body, image: picked })
const { kind } = await task.done
```

Both start the same command descriptor and child owners. `commands` remains
separate from `mutations`, because its task and multi-phase failure model are
not an ordinary mutation promise. Advanced code can use
`app.api.assets.messageImageUpload` directly.

## What v1 proves—and does not

V1 proves that a live process with a readable source and ordinary application
session can compose one asset task and one mutation through a truthful single
task.

It does not prove:

- process-death or app-restart recovery;
- durable source-byte custody;
- offline queueing or ordered settlement;
- multiple assets;
- native background transfer after the ordinary session is unavailable;
- automatic residue deletion;
- true anonymous upload;
- distributed atomicity; or
- a general workflow/saga language.

Those claims require new facts, not just more states in the wrapper.

## Deferred extensions

### Multiple assets

A later version may admit a small fixed bound, such as 1–4 asset inputs, after
the one-asset phase/residue model is proven. It must define partial-transfer
and per-asset residue rather than flattening them into “upload failed.”

### Restart and offline custody

Durable commands require independent receipts for source-byte custody, command
identity, authority cohort, asset-attempt recovery, and mutation settlement.
LLP 0043 governs the capability cut. Retained query storage alone proves none
of these.

### Attempt grants

If native background upload cannot safely carry the ordinary session, LLP 0044
may define a narrow attempt credential issued only after an authorized
reservation. It must bind attempt, app, authority cohort, operation set, TTL,
and revocation; use a dedicated header; remain useless for asset reads and
application mutations; and pass URL-only, cross-attempt, expired, revoked, and
redaction negatives.

An attempt grant is optional transport hardening. It does not create a user,
solve development pairing, or block v1.

### Anonymous claim-on-attach

Truly anonymous upload changes ownership, quota, abuse, attachment, and GC
semantics. It needs a separate LLP 0044/auth decision. A guest principal with
an ordinary session is the preferred first path.

## Delivery

### C0 — descriptor and task shell

- Generate the closed command descriptor inside `AppDescriptor`.
- Implement the wrapper over existing child owners without transport changes.
- Prove text-only execution and declaration refusals.

### C1 — online one-asset command

- Compose the existing asset task and mutation with one ordinary session.
- Prove success, upload refusal, mutation refusal, mutation ambiguity, retry,
  cancel, authority replacement, and finalized-unattached residue.
- Exercise direct headless and React hooks.

### C2 — Expo and external qualification

- Consume LLP 0181's picker/content-URI adapter.
- Prove the LLP 0176 image-message fixture on each claimed Expo OS and from a
  clean published-package repository.

C0–C2 are LLP 0176 G3/G4. The deferred extensions are separate decisions.

## Acceptance

- Text-only and one-image message send use one generated command reference and
  one typed call.
- Image execution starts exactly one existing asset task and one existing
  mutation attempt; no command endpoint or alternate state store exists.
- Reservation, transfer, and mutation use the same ordinary application
  authority cohort.
- The application row is created only by the ordinary mutation and its
  commit-bound attachment check.
- `done` settles to a `CommandOutcome` whose `kind` agrees with the terminal
  snapshot's `status`, and a test asserts that an `ambiguous` outcome is
  distinguishable from `failed` at the `.done` seam without inspecting the
  snapshot — not merely documented as different.
- Upload success plus mutation failure reports residue with explicit
  `authoritative | inferred | unknown` provenance rather than an overstated
  fact, a fabricated deletion claim, or silent deletion.
- Ambiguous mutation settlement never generates a new mutation identity, and
  `retry()` on an `ambiguous` task can still resolve to `committed`.
- A round-3 delta review correctly found this bullet still encoded the
  settlement bug §Terminal-state transitions was fixed to remove: `retry()`
  returns a new task with an independent `.done`, and the **predecessor's
  `.done` settles the instant that task reaches its terminal status** —
  never at retry time, and never left pending merely because no one ever
  calls `retry()`.
- Retrying `succeeded` or a clean `cancelled` does not surface as a
  misleading `kind: "failed"` outcome — a round-3 reviewer correctly noted
  that would recreate the exact "failed looks like safe-to-resend"
  confusion this whole model exists to prevent. It surfaces as a distinct
  `kind: "notRetryable"` outcome instead (§Command task), never `"failed"`.
- Direct command and surface-bound command share the same descriptor and
  behavior.
- Tests make no restart, offline, multi-asset, anonymous, or attempt-grant
  claim.

## Risks

### One task could imply atomicity

The explicit child snapshots, mutation-only commit boundary, residue state,
and ambiguity state prevent “one call” from meaning “one transaction.”

### Composition could grow into a workflow engine

The closed one-asset/one-mutation grammar has no callbacks, loops, multiple
mutations, compensation, or arbitrary phases. New product actions should first
try ordinary application code.

### The wrapper could become a second state owner

Its snapshot is derived from canonical child owners and does not persist an
independent truth. Identity and lifecycle tests enforce that invariant.

### Ordinary sessions may not survive background transfer

That is acceptable for the online v1 claim. It motivates a later attempt-grant
decision but does not justify adding a credential class before the simple path
works.

## Open questions

1. Does `done` resolve after mutation commit even when derivatives are still
   processing, with readiness in the result, or should a command declaration
   select a processing gate?
2. **Decided, removed as an open question per round-2 review:**
   mutation-attempt identity is allocated at §Execution's step 4, after the
   asset finalizes, and this is the accepted default — it already satisfies
   "ambiguous mutation settlement never generates a new mutation identity,"
   since every retry after step 4 reuses the same allocated identity, and no
   named requirement needs earlier allocation. Revisit only if a future
   asset-task framing change makes step-4 allocation insufficient.
3. **Decided, removed as an open question per round-3 review:** §Command
   task already answers this — `unattached: "authoritative"` requires an
   LLP 0044 fact that does not yet exist, so the command reports
   `"inferred"` or `"unknown"` until LLP 0044 exposes it. This question
   restated the body's own answer as unresolved; struck for the same reason
   0179's OQ3 was struck in round 2.
4. Which cancellation outcomes should be stable no-ops versus typed refusals?

## Status

Review. The first accepted slice should be the online, one-asset,
one-mutation command using ordinary session authority. Attempt grants,
multiple assets, restart recovery, offline send, and anonymous ownership are
intentionally deferred and no longer prerequisites for the golden path. A
super-refine round-1 review found that the original `.done: Promise<Result>`
shape could not truthfully distinguish `ambiguous` from `failed` at the call
site; fixed with a discriminated `CommandOutcome` and an explicit
terminal-state transition table (§Command task).
