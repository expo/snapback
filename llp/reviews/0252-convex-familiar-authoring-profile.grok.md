# Grok review — LLP 0252

## Round 1 — 2026-08-12 — FAILED LAUNCH, no review received

- **Runtime:** Grok CLI 1.0.3, model requested `grok-4.6` at reasoning effort
  xhigh (served as `grok-4.6-build`), headless `-p`, capsule-only
  instructions, web disabled.
- **Capsule:** base `d87d8d9a9cb0f35208c889784991ce40b2fcfe27`, inventory
  SHA-256 `478e66c671be06b2f0c1e89c66d22785ce6708b31b64193d1c734667eb5c1263`,
  instruction SHA-256
  `b8ab949dbb24d1a865631bc2a7ed0d7f7130b99bd54dec1f7864b2eefb7662cc`.
- **Target under review:** r1 SHA-256
  `01f35fad3586091e09b5d2b9b1dd0911064f28902b82915482eff9e110552dc6`.
- **Outcome:** the run terminated after 12 model calls (917,859 total tokens,
  781,056 cached reads, ~197 s of API time) with a hard payment error:
  `API error (status 402 Payment Required): Grok Build usage balance
  exhausted`. The session had verified the target hash and byte count and was
  partway through reading the governing corpus (LLP 0236 and the
  authoring/identity/lifecycle RFCs) when the balance ran out. No concern
  ledger, no verdict, and no self-attestation were produced.
- **Disposition:** recorded as a failed launch per LLP 0010 §2; it produces no
  verdict and is never counted. The 592 bytes of preamble narration on stdout
  are not a review and are not treated as one. Grok-family launch count for
  this target: 1 of 6.
- **Loop consequence:** Grok was an author-specified reviewing family, so its
  unavailability stops the loop for the author's ruling after the two
  in-flight family reviews land. Rerunning requires the author to restore
  Grok Build balance; no substitute model is used silently.

## Independent review — 2026-08-12 — r4

**Reviewer family:** Grok
**Provider / runtime:** Grok 4.6 in Grok Build TUI (interactive session;
not the failed super-refine CLI launch above)
**Date:** 2026-08-12
**Redacted:** no
**Method:** interactive session, worktree review (not capsule-blind)

- **Target under review:** r4 SHA-256
  `cdc724825c32fe24c488fc443c96581bfdcdb7ef76a9966f8039dfe9692ab001`
  (55,161 bytes, 1,055 lines), Status: Review. Hash and byte count verified
  on disk before the verdict was written.
- **Blindness disclosure:** this is **not** a mutually-blind super-refine
  capsule review. The session read the target, the governing LLPs and
  shipped surfaces cited below, and — after those reads — the existing
  `llp/reviews/0252-*` artifacts (including the run journal's r4 pin list).
  Prior-family ledgers are **not** counted as this review. Concerns below
  are those this session verified against the current text and the shipped
  corpus; overlap with earlier r3 findings is noted where it exists.
- **Lens:** LLP 0005 standard prompt (is the idea right, is the plan
  implementable, what is wrongheaded, what would change) plus an
  implementer probe over D2/D4, focused on the unreviewed r4 pins.
- **Verdict:** NOT READY (2 MATERIAL, 5 DETAIL). Direction retained; no
  DIRECTION-DISSENT.

The complete review follows.

---

# Review — LLP 0252: Convex-familiar authoring profile (r4, Grok family)

Target: `llp/0252-convex-familiar-authoring-profile.rfc.md`, 55,161 bytes,
SHA-256 `cdc724825c32fe24c488fc443c96581bfdcdb7ef76a9966f8039dfe9692ab001`.

## Direction assessment

**Retain the RFC's direction.** A bounded, parallel, Convex-familiar
TypeScript source profile that lowers into one canonical Snapback
pipeline, with a measured comparison period and a hard stop, is the
right experiment. It is not a rewrite, not in-place replacement of the
control lane, not guide-only, and not Convex compatibility.

The evidence the RFC cites is real and is used at the right grain:

- LLP 0198's remaining gap is orientation, not residual defects. Familiar
  grammar is the one untested lever on that term; LLP 0203 P6 predicts it
  matters.
- LLP 0236's 55/45 seven-app split and "smoother conventional TypeScript
  default" / day-two reversal are quoted accurately.
- LLP 0199 / 0225 correctly close a core restart. The value to keep is
  the Rust/SQLite/runtime stack and the evidence boundaries, not the
  first-hour dialect.
- Exact compatibility would import public-by-export, universal reactivity
  claims, and untruthful settlement. Declining that is a product decision,
  not timidity.

The strongest rival remains a server-only experiment. I considered
dissenting toward it. I do not. `useQuery(api.x.y)` is among the highest
prior sequences an agent holds; a half-familiar stack would confound the
readout the RFC exists to produce. The ablation lane
(`snapback-familiar-server-v1`), component sub-attribution, and
mid-period alias withdrawal make the bundled treatment reversible
without making it unmeasurable. That is the right compromise.

Portfolio caveat, not a dissent: LLP 0198 still names hosted operations,
not syntax, as the largest stable deficit. Acceptance of 0252 must not
be read as sequencing this experiment ahead of that P4 decision. The
Status section already says this.

## Overall assessment

r4 is a strong, implementable-in-outline RFC that has absorbed three
rounds of dual-family pressure on comparison design, identity, stop-rule
eligibility, and most of the D2/D4 contracts. The unreviewed r4 close-out
fixed the phantom per-operation queue-policy fact correctly: familiar
`useMutation` as LLP 0218's dispatch-time settled-only convenience
(`queue: false`) matches the shipped model
(`llp/0218-outbox-settlement-contract.rfc.md` §4.1; no definition-level
queue key in `packages/snapback-codegen/define.mjs` or
`schemas/app.ensure.input.schema.json`).

Two r4 pins, however, are not closed contracts. They are the reason this
revision is NOT READY.

## Strengths

- **D1's one-pipeline rule** is the document's load-bearing invariant,
  and the admission-check exemption (profile-brand refusal is not a
  semantic branch) makes the Phase 0 no-branch gate implementable.
- **D3** is a clean, scoped use of LLP 0119 option 1b that correctly
  refuses to silently settle LLP 0130 ER-3 for the existing profile.
- **D4's `useQuery` projection table** is total over LLP 0238/0247
  states, uses the 0247 state-versus-error line, and honestly names the
  `Result | undefined` collapse as the measured question rather than
  claiming it is type-safe.
- **D6's four-state table as the normative v1 enumeration** (absent =
  unsupported) is the right fail-closed device.
- **D7** now has preregistered disposition eligibility, a second-family
  N≥3 Promote gate, configuration-versioned withdrawal, and a mechanical
  freeze backstop. That is what keeps two surfaces from becoming two
  products by inertia.
- **D8** correctly treats profile version as a semantic-identity input
  (LLP 0246 precedent) and `normalizedContractId` as a non-authorizing
  witness. Familiar→explicit as the apply-capable safety valve before
  the clock starts is the right asymmetry.

## Concern ledger

### 1. MATERIAL — D2 familiar action `ctx` invents `ctx.runQuery`

r4 pins familiar-action composition as "the canonical composition seam
spelled over familiar-branded refs (`ctx.runQuery(api.x.y, args)`,
`ctx.runMutation(api.x.y, args)`)." That sentence is false for
`runQuery`.

The shipped action context has `runMutation(name: string, args)` only
(`packages/snapback-harness/ctx-bootstrap.js` around the
`action.runMutation` host op; generated `GeneratedActionContext` in
`guide/reference/expo-snapback-codegen--ctx.md` and every
`generated/api.d.ts` sampled). The harness comment is explicit: "Queries
are reads and actions must enter through runMutation." There is no
`action.runQuery` host op. LLP 0118 treats `ctx.runQuery` as Convex's
composition family, not Snapback's. LLP 0070 mentions `ctx.runQuery` on
the *job* runtime, which is a different owner and is not the portable
action `ctx`.

`ctx.runMutation(api.x.y, args)` can be honest adapter sugar: a
familiar-branded ref lowers to the existing name-based host op. That
half is a spelling. `ctx.runQuery` cannot lower to an existing seam. An
implementer must invent a new host capability (runtime behavior, which
D1 says the adapter does not own), refuse the call (contradicting the
pinned example), or silently desugar into something unspecified
(in-process query execution? a hidden mutation? a one-shot client
read?). Those are different products.

This is the same class of defect r3 caught on the phantom queue-policy
field: a contract-bearing surface presented as a projection of an
existing canonical fact that the canonical model does not have.

**Resolves when** the document picks one of:

- **A (recommended).** Familiar actions expose only
  `ctx.runMutation(FamiliarMutationRef, args)`, documented as a lowering
  onto `action.runMutation`. `ctx.runQuery` is D6 `unsupported` with a
  stable refusal and a route (compose via mutation, or wait for a
  separately owned host op). Effect-free compute remains legal, as r4
  already says.
- **B.** `ctx.runQuery` is a new canonical host capability with a named
  owner (not this RFC), a host op, snapshot/transaction semantics, and
  an explicit-profile spelling. This RFC may then project it. Do not
  smuggle that capability in as "familiar spelling."

Do not leave both the example and the "canonical seam" claim in place.

### 2. MATERIAL — D4/D6 skip pin contradicts itself

r4 pins conditional consumption as `same-shape` "with the canonical skip
sentinel" (zero demand, projects `undefined`). Those two claims cannot
both be true.

- Convex's ordinary call is `useQuery(ref, cond ? args : "skip")` —
  the string `"skip"` as the second argument. Messaging-convex in this
  repo writes exactly that.
- Snapback's shipped skip is an imported identity sentinel
  (`skip` from `@expo/snapback-react`, tested with `args === skip` in
  `packages/snapback-react/package.test.mjs`). The guide's ordinary
  spelling is `useSnapbackQuery(ref, cond ? args : skip)`.
- D6 `same-shape` means "name and ordinary call shape are intentionally
  familiar; documented Snapback semantics fit without qualification."
  The call shape is not the same: `"skip"` versus imported `skip`.
- If the familiar hook accepts only the canonical sentinel, Convex-prior
  agents will write `"skip"`. Depending on the args validator that is
  either a typed refusal or, worse, a string passed as arguments.

Two implementers diverge on the hook's second-argument contract, which
is the strongest Convex prior after `useQuery(api.x.y)` itself. r3
already identified this as contract-bearing; r4 attempted to close it
and closed it with two incompatible facts.

**Resolves when** D4 states the accepted second argument as a closed
set, and D6's row matches that set. Recommended pin: familiar `useQuery`
accepts `Args | "skip" | typeof skip`; `"skip"` and the imported
sentinel are equivalent and both lower to the canonical zero-demand
skipped state; the return remains `undefined`. Then `same-shape` is
honest for the Convex spelling, and D5/canonical hooks keep the imported
sentinel. If the author instead refuses `"skip"`, the row is `narrower`,
not `same-shape`, and generated JSDoc must say so at the call site.

### 3. DETAIL — D2 example specifies Convex `withIndex(name, callback)`

The D2 query example writes:

```ts
ctx.db.query("todos")
  .withIndex("by_owner", (q) => q.eq("ownerId", ctx.auth.userId))
  .collect()
```

Shipped Snapback `ctx.db` is a different grammar. `withIndex` is a
name-only setter; filters are chained
(`.withIndex('by_owner').eq('ownerId', …)`;
`guide/backend/queries.md` "complete builder chain";
`packages/snapback-harness/ctx-bootstrap.js`). D2 also says the familiar
profile "adds no third read grammar."

The extra callback argument is currently ignored. An implementer who
reuses the shipped builder will drop the owner filter and `.collect()`
the index, which is an authorization-shaped footgun, not a style
mismatch. An implementer who admits the callback has added a third
builder grammar and must say whether that is source-desugaring, a
generated ctx wrapper, or a profile-conditioned VM `ctx`.

This is DETAIL rather than MATERIAL because D6's normative table plus
"no silent unknown" already refuse an unspecified construct, and the
example can be repaired without changing the experiment. It is still
the first snippet an implementer will treat as the admitted surface.

**Resolves when** the example uses the shipped chain, *or* D2/D6
explicitly admit callback-`withIndex` as adapter/generated-ctx sugar
that lowers to the same host plan, with a test that the filter cannot
be dropped.

### 4. DETAIL — D4 `useAction` has no closed callable contract

`useMutation` now has a closed signature. `useAction` is only "a direct
alias over one-shot `run(ActionRef)`." Convex `useAction` is
`useAction(ref) => (args) => Promise<Result>`. "Direct alias over
`run`" can be read as a render-time call. LLP 0238 ships no action hook
(only `client.run` and `useSnapbackTask` for commands), so there is no
canonical callable to inherit.

**Resolves when** D4 gives `useAction` the same closed form as
`useMutation`: `useAction(FamiliarActionRef) => (args) => Promise<Result>`,
always one-shot, no task ownership, rejections via the canonical typed
error.

### 5. DETAIL — D4 diagnostic trigger "declared offline requirements"

After dropping the phantom queue-policy field, the mismatch diagnostic
fires "when the application's declared offline requirements ask for
queued custody that settled-only dispatch cannot honor." There is no
application-level "offline requirements" declaration in the current
manifest or in LLP 0218. Offline is a per-dispatch option plus
per-query retention opt-in.

**Resolves when** the trigger is named against a real fact (for
example: a retainable live query in the same generation, an explicit
template/workload flag, or always-on JSDoc with no generation gate),
or the sentence is dropped and routing stays in static JSDoc only.

### 6. DETAIL — D4/D5 `delivery: "read"` consumption cliff

A familiar `delivery: "read"` query is rejected by `useQuery` and has
no canonical React hook (LLP 0238 v1 ships no `useSnapbackRead`;
one-shot work is `client.read`). r4 names this as Phase 2 owned JSDoc
work. That is enough to implement around, but the D5 progression should
state the route in the RFC itself: authored `delivery: "read"` →
`client.read` / event-time one-shot, not a hook. The benchmark will
price the cliff either way.

### 7. DETAIL — D4 post-throw / boundary-reset still owned only as Phase 2 work

The projection table is total over states. The temporal contract
(rethrow while the canonical state stays error-class; who resets the
boundary when the subscription recovers) is still "pinned to Phase 2
with the documented error-boundary guidance." Fine as implementation
work if Phase 2's landing diff includes a generated state × time table.
Not a readiness block.

## Implementer probe

**Familiar function object (D2).** Kind from the generated constructor.
Matrix: `args`/`returns`/`auth`/`handler` required; `reads` required on
query/mutation, forbidden on action; `writes` required on mutation,
forbidden elsewhere; `delivery` optional on query, default `"live"`;
effects/secrets/capabilities/runtime declared when used; unknown keys
refuse; `refusals`/`trackedRefusals` direct; sequences/plans/isolated
Node form unsupported. Missing `returns` or reach keys may produce an
LLP 0245 read-only suggestion; everything else required-and-absent
refuses. Handlers are LLP 0237/0246 graphs.

Underdeterminations: (1) action `ctx.runQuery` — concern 1; (2)
`withIndex` callback in the normative example — concern 3.

**`useQuery` (D4).** Familiar-branded live-capable ref; runtime profile
discriminant before resource work; total projection table; skip
undetermined between `"skip"` and imported `skip` — concern 2.

**`useMutation` (D4).** Closed. `(args) => Promise<Result>`; always
dispatches `queue: false`; rejects offline before custody; never maps
queued intent to success. Diagnostic trigger underspecified — concern 5.
This is no longer the material underdetermination it was on r3.

**`useAction` (D4).** Callable versus render-time call underspecified —
concern 4.

## Suggestions

1. Treat `"skip"` as familiar-only sugar over the imported sentinel.
   That is the whole method of this RFC: a learned spelling that lowers
   onto an existing Snapback fact. Do not mint a second skip owner.
2. Do not invent `ctx.runQuery` here. Measure agents writing it. If the
   familiar lane loses because actions cannot read, that is component
   evidence for a later host-op RFC, not a reason to hide the seam.
3. Physically isolate the experimental React aliases
   (`@expo/snapback/react/familiar` or the umbrella `/react` export
   gated by the profile brand at both type and runtime, which D1
   already requires). Withdrawal then deletes an entrypoint instead of
   leaving a type-branded ghost next to `useSnapbackLiveQuery`.
4. Change the D2 query example to the shipped chain *unless* callback
   `withIndex` is explicitly admitted. The current snippet is the one
   agents will copy.

## Open questions (document's OQ1–OQ7, plus)

The document's OQ1–OQ7 are the right ones. OQ2 (alias value) and OQ3
(query default) are correctly measured rather than decided. OQ7 must
stay preregistered in Phase 0.

Additional, from this review: once concern 1 is pinned, is a
`ctx.runQuery` host op in scope for the explicit profile during the
same experiment, or is it out of 0252 entirely? I would keep it out.

## Recommended next step

Stay `Review`. Do not accept r4 as-is. Apply the two MATERIAL pins
(action `ctx` without inventing `runQuery`; skip second-argument closed
set) and the `withIndex` example repair. After that, the author may
accept or commission a short delta review of the r4→r5 pins. This
review does not accept on the author's behalf.

VERDICT: NOT READY — bound to SHA-256
cdc724825c32fe24c488fc443c96581bfdcdb7ef76a9966f8039dfe9692ab001

---

## Self-attestation

I verified the target at 55,161 bytes and SHA-256
`cdc724825c32fe24c488fc443c96581bfdcdb7ef76a9966f8039dfe9692ab001`
before writing the verdict. I read the target in full. I checked the
claims above against `llp/0218-outbox-settlement-contract.rfc.md`,
`llp/0238-explicit-client-lifecycles.rfc.md`,
`llp/0247-ordinary-client-normalization-and-recovery.rfc.md`,
`llp/0245-infer-show-freeze-declarations.rfc.md`,
`llp/0130-program-standing-decisions.decision.md`,
`llp/0119-reactive-by-default-and-live-search.research.md`,
`llp/0198-surpass-convex-agent-authoring.plan.md`,
`llp/0236-clique-cross-model-authoring-friction.research.md`,
`llp/0070-durable-background-work.rfc.md`,
`guide/backend/queries.md`, `guide/backend/actions-and-fetch.md`,
`guide/reference/expo-snapback-codegen--ctx.md`,
`packages/snapback-harness/ctx-bootstrap.js`,
`packages/snapback-react/package.test.mjs`, and
`packages/snapback-react/index.mjs`. I did not modify the RFC. I did
not use an external review provider. I read existing 0252 review
artifacts after the corpus checks; this review is therefore not
capsule-blind and is not a super-refine round-4 launch. The failed
round-1 Grok CLI launch above remains uncounted.
