# LLP 0275: Essential declarations and invisible ceremony

**Type:** RFC
**Status:** Draft
**Systems:** Authoring, Code generation, Application data API, Auth,
Authorization, Runtime readiness, Packaging, Templates, Verification,
Developer experience, Guide, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-17
**Revised:** 2026-08-25 (D6's concrete React/Vite template typecheck gap is
closed for both packaged Vite templates; broader cold-install closure remains
owned by the first-use ceremony budget harness.)
**Revised:** 2026-08-23 (D9's supported root package
`@expo/snapback-acceptance` first-published in the qualified fourteen-package
0.1.25 closure from `9d9265394953`; package publication does not make it a
second proof authority. The four LLP 0283 F-1 defect families remain open, the
LLP 0284 gates remain red by design, and no adversarial-handler containment is
claimed.)
**Revised:** 2026-08-22 (D9 terminal-cleanup reconciliation: lifecycle stop
has an independent bounded last-chance controller, so cleanup callbacks and
client inspection cannot starve its once-only managed-child termination.)
**Revised:** 2026-08-22 (D9 delta-review reconciliation: completeness is
passed-per-path, caller retry signals compose with the active execution signal,
and external abort preserves a fresh reserved-cleanup deadline through managed
child termination.)
**Revised:** 2026-08-22 (D9 review-fix reconciliation: builder tokens are
definition-owned and generated-reference identity is artifact-generation
bound; admission correlates each exact path id to both its operation entry and
passed check; one overall deadline reserves bounded cleanup and propagates
AbortSignal cancellation; lifecycle evidence and the three ejection levels
are stated honestly.)
**Revised:** 2026-08-22 (author ruling: the recurring starter acceptance
harness becomes the public `@expo/snapback-acceptance` root entrypoint. The
package owns platform lifecycle and receipt compatibility while product
assertions and evidence intent stay in application source; a versioned
eject/extend contract remains supported. D9 records the ruling and API.)
**Revised:** 2026-08-22 (W3 implementation evidence: VCF-E-P1–P4 derive exact
closed-plan result/dependency facts with provenance, including final-write
binding shadowing, nullable return-document settlement, and its implicit read;
incompatible authored result controls refuse. VCF-E-L1 supplies recurring
scaffold/install/generate/dev/prove wiring while preserving authored policy.
D4, D5, the remaining Explicit fixtures, and D7 measurement remain open.)
**Revised:** 2026-08-21 (LLP 0295 D0.3 amendment: D1's four-class taxonomy
applied fact-by-fact to the Explicit profile's authored surface, and the W3
Explicit economy lane registered with its fixture receipts. Adopted per
LLP 0295; author may revise.); 2026-08-17
**Related:** LLP 0010, LLP 0041, LLP 0108, LLP 0117, LLP 0123, LLP 0146,
LLP 0172, LLP 0186, LLP 0189, LLP 0196, LLP 0198, LLP 0231, LLP 0241,
LLP 0245, LLP 0252, LLP 0253, LLP 0259, LLP 0264, LLP 0274, LLP 0295,
`issues/20260821-authoring-profile-vertical-contract-fixtures.md`

## Summary

Snapback should keep declarations that express application decisions and remove
manual ceremony that merely transcribes derivable facts, replays platform trust
checks, or opts into claims the author is not making.

The governing rule is:

> **Decisions stay explicit. Facts are derived once. Trust checks run
> automatically. Evidence obligations scale with the claim.**

This RFC classifies the four kinds of ceremony exposed by an ordinary React
bug-tracker build:

1. table visibility is a security decision and remains explicit;
2. result contracts remain enforced, but exact contracts derivable from a
   closed declarative plan should not be re-authored;
3. runtime qualification remains mandatory evidence for a runtime-dependent
   claim, but the golden path should acquire or validate it automatically; and
4. acceptance registration remains mandatory for an acceptance claim, but is
   not a prerequisite for running an app or obtaining a narrower platform
   readiness verdict.

The objective is not fewer guarantees. It is that no guarantee has to be
stated or triggered twice.

## Motivation

Diary 0091 built Bugboard, a small React/Vite bug tracker, from the public
npm `0.1.24` starter. Snapback's generated references, live query, declarative
writes, and identity-bound proof were strong. The first-use path nevertheless
exposed four different obligations as one undifferentiated feeling of “more
declarations than Convex or Supabase”:

- `.visibility({ kind: 'public-read' })` selected a real disclosure policy;
- `result: results.value(...)` transcribed types already determined by
  `returnBinding(...)` and `returnChangedCount()` in a closed mutation plan;
- `snapback runtime-qualify --persist` was a manual prerequisite discovered
  only after `prove` failed, even though the exact packaged runtime and its
  qualification mechanism were already known; and
- expanding the starter from todos to bugs required synchronized edits to the
  acceptance implementation and its separately declared path registry.

These costs do not have the same justification. Treating all explicitness as
good preserves avoidable friction; treating all explicitness as bad weakens the
security and evidence boundaries that distinguish Snapback.

The existing corpus already supplies the pieces:

- LLP 0231 makes table visibility a mandatory policy decision and rejects
  inferring it from field names.
- LLP 0108 keeps closed result contracts as the runtime egress and generated
  client boundary.
- LLP 0245 establishes “infer, show, freeze” for facts that can be proposed
  without granting authority.
- LLP 0123 records the operational finding that handler-VM readiness is
  behavioral evidence, not file presence or identity.
- LLP 0146 proposes `snapback verify` as the composed done-oracle and keeps
  zero-profile receipts distinct. (It remains Draft; its verify receipt is
  already consumed under the author ruling recorded in LLP 0245.)
- LLP 0189 binds verification cost to the claim being made instead of every
  edit or commit.
- LLP 0198 says to make the first fifteen minutes as cheap as Convex's while
  keeping the semantics Convex would have to rebuild — among them the closed
  result contract, determinism, server-derived identity, and the evidence
  culture.

No one document applies those constraints as a coherent authoring rule. This
RFC does.

## Principles

### P1. Application decisions are authored, not guessed

The author must explicitly choose any declaration that grants, restricts, or
changes authority or externally visible policy. This includes:

- table visibility and field-disclosure boundaries;
- function authorization requirements;
- write-authority posture;
- secret and external-effect access;
- retention, asset delivery, and public exposure; and
- portability or target posture when behavior differs by target.

Generated suggestions may explain choices and show patches. They must never
select one of these policies from field names, example data, observed calls, or
the absence of a failing test. In particular, an `ownerId`-shaped field is not
evidence that owner visibility is correct; a messages table and a hidden-hands
table can share that schema shape while requiring opposite policies.

### P2. One semantic fact has one authoring authority

When authored source already determines a fact exactly, Snapback should derive
and project it rather than require a second synchronized declaration.

Examples:

- `insert('bugs', ..., { bindIdAs: 'bugId' })` plus
  `returnBinding('bugId')` determines `v.id('bugs')`;
- `returnChangedCount()` determines an integer result;
- `returnDocument('bugs', id)` determines the nullable value contract
  `results.value(v.union([v.null(), v.doc('bugs')]))`; and
- a closed declarative read or write plan determines its table dependency set.

The derived effective contract remains hashed, generated, reviewable, and
runtime-enforced. “Inferred” does not mean ambient, heuristic, or unversioned;
it means mechanically derived from another committed authoritative construct.

Opaque JavaScript is different. Where the source does not prove a closed
contract, LLP 0245 continues to govern: propose a reviewable patch, expose
holes, and freeze accepted source. TypeScript inference alone does not become
runtime authority.

### P3. Automation may remove a command, never a check

Artifact freshness, native runtime readiness, capability resolution, and
schema/function admission are platform checks. If the CLI can safely perform
or validate one from the exact selected inputs, the golden path should do so
without requiring a separate preparatory command.

The check must retain:

- the same behavioral probe;
- digest binding to the exact binary and native artifacts;
- target-aware applicability;
- a persisted or package-owned receipt with explicit custody;
- stable failure codes and remediation; and
- a standalone diagnostic command for operators and debugging.

Removing `snapback runtime-qualify --persist` from the normal sequence therefore
means folding qualification or seal validation into `snapback verify` (and the
relevant packaged startup boundary), not trusting an unqualified runtime.

### P4. Evidence obligations are proportional to the claim

Running an app, establishing platform readiness, proving registered product
journeys, and publishing a capability are four distinct claims.

- **Run:** the app may start when its selected runtime and artifacts satisfy
  the startup contract. No acceptance profile is implied.
- **Platform-ready:** artifact, runtime, admission, and capability stages may
  pass without a product journey. The receipt remains
  `passed-without-acceptance`.
- **Journey-proven:** every claimed path is registered and observed under a
  bound target, data, authority, seed, and test-byte identity.
- **Published capability:** the relevant qualification and LLP 0189 claim
  gates apply in addition to journey evidence.

The CLI and documentation must name the level reached. A lower level must
never borrow the language or status of a higher one.

### P5. Templates own recurring platform ceremony

A first-party template should absorb stable, non-application-specific setup:

- coherent package versions and TypeScript libraries;
- generated-directory and provider wiring;
- runtime-readiness acquisition through the ordinary proof command;
- a real starter acceptance profile;
- stale-profile detection when starter operations are replaced; and
- one `dev` command and one `prove` command.

The author should edit product semantics, not repair the template's toolchain or
rediscover platform preconditions. A template defect is a product defect even
when the diagnostic is actionable.

### P6. Proof intent is authored once

Acceptance registration must not infer that an operation was tested merely
because it exists or was invoked somewhere. That would turn execution into an
unearned claim.

It should, however, avoid duplicated registries. A profile's expected path and
the test observation that discharges it should share one typed identity or one
generated-reference-backed declaration. Deleted or renamed functions must make
the old starter path visibly stale. Adding an operation may produce a
suggestion or an honest “unclaimed operation” note, never an automatically
passing path.

### P7. The first-use loop has a ceremony budget

For a supported npm template, the normal lifecycle is:

```sh
snapback new <app> --template <template>
bun install
bun run dev
bun run prove
```

`dev` owns generate/start/load/client/watch. `prove` owns every applicable
readiness and registered-acceptance prerequisite; in every first-party
template it is a pre-configured `snapback verify` invocation, not a second
proof surface, and this RFC uses the two names for the same composed command.
A separate command is allowed for diagnosis, repair, destructive choices,
credentials, or an application decision; it is not allowed merely because two
platform stages were implemented by different packages.

## Decision

### D1. Adopt the four-class ceremony taxonomy

Every new author-facing declaration or prerequisite must be classified as one
of:

| Class | Examples | Default authoring treatment |
| --- | --- | --- |
| Policy decision | visibility, auth, effects, retention | explicit, greppable source |
| Derivable semantic fact | closed-plan result and dependencies | derive once; show effective projection |
| Environment integrity | runtime readiness, artifact freshness | automatic check with receipt |
| Evidence/claim | acceptance path, publication scope | optional until claimed; mandatory and bound afterward |

Design and review documents must state the class. “Explicit is safer” is not a
sufficient argument for duplicating a derivable fact, and “the tool can infer
it” is not a sufficient argument for choosing a policy.

### D2. Keep visibility explicit and make the choice cheap

LLP 0231 remains authoritative: every table reaches an explicit visibility
policy, and public-read remains a deliberate disclosure choice. This RFC does
not weaken that requirement or permit schema-based inference.

Templates should start with an honest policy for their demonstrated data, and
scaffolding or diagnostics should present the closed set of visibility
policies with their disclosure consequences. One table-level choice should
cover ordinary reads; authors should not repeat the same policy per query.

### D3. Derive exact result contracts from closed plans

Codegen should compute an effective result contract when a declarative plan's
return form determines it without ambiguity. The initial admitted forms are:

- `returnBinding` whose final binding write in evaluation order is an ID
  minted by a typed `insert` (a later `Insert`, `Get`, `Let`, or allocation
  shadows the earlier value);
- `returnChangedCount`;
- `returnDocument(table, id)`, as the nullable union of the table document and
  `null` because the resolved id may be absent;
- `returnLiteral` for an exactly representable closed literal; and
- `returnExpr` only where the expression algebra proves the complete validator
  without inventing bounds or refinements.

An explicit compatible `result:` remains allowed. An explicit incompatible
contract fails generation. An underivable result remains `unknown` or requires
an authored contract according to LLP 0108's existing rules; codegen must not
widen a partial derivation into confidence.

The generated manifest adds a provenance marker — `authored`, `plan-derived`,
or `unknown` — beside the existing result-contract kind and hash, and the
generated client consumes the effective contract identically. This is a
closed-IR derivation, not a weakening of LLP 0245's rule for opaque TypeScript
or JavaScript.

### D4. Fold packaged runtime qualification into the ordinary proof

For an exact packaged runtime, `snapback verify` should first validate any
package-owned readiness seal and existing digest-bound local receipt. If the
selected target requires a local behavioral probe and no valid receipt exists,
it should run the bounded qualification probe, persist the receipt, and
continue. A failure stops at the same runtime-readiness stage with the same
structured diagnostic.

The standalone `snapback runtime-qualify` command remains for inspection,
explicit requalification, packaging, and recovery. It becomes a tool beside
the golden path, not a prerequisite the author discovers through failure.

Startup may perform the same validate-or-qualify operation when the target's
safe serving contract requires it. Target profiles that do not use the local
handler VM retain an explicit not-applicable result; no local receipt is
misapplied to a hosted target.

### D5. Make acceptance profiles single-source and staleness-aware

Verification keeps explicit expected paths, but the profile/test API should
bind them through generated operation references rather than unrelated string
copies. The runner must report observation against that same identity.

The verifier should distinguish:

- registered and observed;
- registered but not observed;
- registered against a stale/deleted operation;
- observed but not claimed; and
- generated operation with no acceptance claim.

Only the first class contributes a passing journey claim. The last two are
useful authoring information, not failures unless the configured claim scope
requires completeness.

First-party templates retain one real starter profile. When an author replaces
the starter's operation set, the verifier emits a typed remediation that points
to the exact stale registration and the new unclaimed operations. It never
silently claims the replacements.

### D6. Treat template cold-install closure as a release requirement

Each published template must be tested from packed npm bytes through:

1. scaffold;
2. install;
3. generate;
4. typecheck and production build where applicable;
5. supervised startup; and
6. the one proof command, without a separately documented qualification step.

The test must run outside the Snapback workspace so hoisted dependencies,
source-checkout receipts, and sibling artifacts cannot make it pass. The
Bugboard typecheck failure in `issues/closed/20260817-react-template-typecheck-node-types.md`
is an example of the class this gate owns.

### D7. Measure ceremony without rewarding hidden work

The authoring benchmark records separately:

- application decisions authored;
- derivable facts manually transcribed;
- platform commands manually invoked;
- proof/claim declarations authored;
- correction loops caused by templates or tooling; and
- semantic corrections caught by the explicit boundaries.

A reduction counts as an improvement only when the same effective policy,
runtime validation, generated type, and evidence claim remain. Moving a step
into undocumented generated code or silently downgrading a receipt does not
reduce ceremony; it hides it.

### D8. Explicit-profile classification under LLP 0295 D0.3 (2026-08-21)

LLP 0295 D0.3 asks which Explicit facts are policy decisions versus
derivable repetition. Applying D1's taxonomy fact-by-fact to the Explicit
authored surface, the classification is (**Adopted per LLP 0295; the
author may revise.** This D8 classification is the D0.3 ruling and carries
that ruling's status on its own; LLP 0275's other sections remain Draft
pending author acceptance, and D3–D5's mechanisms remain governed by their
existing owners — LLP 0108/0245 for result contracts among them — until
accepted and implemented).

First, two kinds of authored Explicit source sit outside the four ceremony
classes and are named here so the classification is exhaustive:

- **Product semantics — not ceremony at all:** schema, table, and field
  definitions; operation names; argument contracts (`args` ingress
  validators); and authored declarative-plan or handler behavior. These
  are the application itself. No derivation question arises; the taxonomy
  classifies obligations *around* them, never them.
- **Authored-because-underivable semantic facts:** result contracts for
  opaque JS/TS handlers and any fact D3's closed rules cannot prove. These
  are authored not because they are policy but because no closed
  derivation exists; they stay under LLP 0108/0245 (suggest, review,
  freeze) and move to the derivable lane only when a closed plan or an
  accepted derivation rule covers them.

Everything else on the authored Explicit surface classifies as:

| Class | Explicit facts | Treatment |
| --- | --- | --- |
| Policy decision (stays authored) | table visibility and field-disclosure boundaries; `auth`; write posture; authority/membership profiles and `authScopeField`; `effects`; `secrets`/`uses`; `capabilities`; `runtime` profile; retention/`retainable`; asset delivery/access/location policy; delivery choice (live vs one-shot); portability/target posture; public exposure | explicit, greppable source; never inferred (P1) |
| Derivable semantic fact (derive once) | result contracts determined by a closed declarative plan (D3's `returnBinding`, `returnChangedCount`, `returnDocument`, `returnLiteral`, provable `returnExpr`); a closed plan's table dependency set; the effect ceiling derived from declared reach; `defaultLive` from the delivery fact; generated references, manifests, and normalized ids | derived, hashed, projected with provenance; a duplicate authored copy is ceremony, and a conflicting one fails generation (D3) |
| Environment integrity | runtime qualification/readiness receipts; artifact freshness; capability resolution; schema/function admission | automatic check with receipt (D4); no manual prerequisite command on the golden path |
| Evidence/claim | acceptance path registration; journey-proven and published-capability claims; publication scope | optional until claimed; mandatory, single-source, and staleness-aware once claimed (D5, P4/P6) |

One boundary note. `reads`/`writes` sit on the boundary: the
declared reach is authority-bearing where it narrows what a handler may
touch (policy), while its projections (effect ceilings, dependency
manifests) are class 2 and never re-authored.

This classification is the contract behind LLP 0295 W3's **Explicit
economy lane**: apply the derivable lane (D3), the automatic
environment-integrity lane (D4), and single-source proof identity (D5) so
Explicit authoring converges on decision density — every authored line is
product semantics, a policy decision, a claim, or an
authored-because-underivable contract, never a transcription of a
derivable fact — with no weaker visibility, type, runtime, or evidence
verdict (D7). The existing implementation tickets above remain the
mechanism owners; the vertical fixtures VCF-E-P1..P4, VCF-E-L1, and the
rest of the
Explicit-lane catalogue in LLP 0253 S9.2 are the lane's acceptance
receipts, executed through
`issues/20260821-authoring-profile-vertical-contract-fixtures.md`.

**Implementation evidence (2026-08-22).** VCF-E-P1–P4 now derive exact
`returnBinding`, `returnChangedCount`, and `returnDocument` contracts plus the
closed plan's read/write table facts. The proof includes final-write binding
shadowing across Insert/Get/Let, the nullable present/absent return-document
paths, and a patch-A/return-B plan whose published reads include B. A mismatched
authored result for the shadowed insert refuses before output; authored-
compatible result controls retain the same effective manifest and authority
facts. An authored `reads` field is separately rejected by the closed grammar
as unknown, not presented as a derived/authored conflict comparison. The
improvement is fewer semantic correction actions, not a line-count claim.
VCF-E-L1 scaffolds and proves the fixed install → generate → dev → prove
lifecycle against W1's M1→M2 continuity carrier. Authored policy is unchanged.
D4, D5, `returnLiteral`/provable-`returnExpr` expansion, the other VCF-E rows,
and the corpus-wide D7 ceremony measurement remain open.

### D9. Public starter acceptance runner (author ruling 2026-08-22)

**Ruling.** The recurring starter acceptance harness is a small supported
public package, **`@expo/snapback-acceptance` at its root entrypoint**. It is
not copied into templates and is not a private template implementation detail.
This section is author-ruled and may be implemented even while the rest of
D5 remains Draft.

Two guardrails bind the ruling:

1. **Product meaning stays in application source.** Application assertions,
   journey order, expected product outcomes, and the evidence intent attached
   to a path remain visible beside the app. The package owns platform
   lifecycle, session minting, application-readiness waiting, bounded retries
   and callback deadlines, verifier receipt shape, cleanup, and the starter
   conformance projection. It must not absorb domain assertions or infer that
   invoking an operation proves the application intended to test it.
2. **Eject and extension stay supported.** Authors may add steps and resources,
   replace the managed-lifecycle adapter, or eject the default runner through
   the explicit compatibility contract below. They do not have to fork an
   undocumented template implementation or reproduce verifier-private receipt
   fields.

#### Harness inventory and ownership split

The four first-party live acceptances contain the following split. Static
source/generated coherence checks remain separate `acceptance.static.mjs`
tests; this runner does not turn source grep into live journey evidence.

| Template | Recurring platform-owned machinery moved to the package | Application-owned journey and evidence intent retained in source |
| --- | --- | --- |
| React | isolated temp database and ready file; `snapback dev` supervision; bounded stdout/stderr and lifecycle events; application-ready wait; polling deadline; cleanup and receipt projection | browser auth bootstrap expectations; signup/recovery, reload, authenticated-entry refusal, and sign-out assertions; todo query, generated React binding, mutation settlement, and live observation |
| CRUD dashboard | isolated lifecycle/readiness; first-call no-retry rule; failure normalization; subscription/process/temp cleanup; identity and receipt projection | relational directory shape; create-project result; live detail update; delete observation |
| Media feed | the same lifecycle/readiness/cleanup machinery plus ordinary-session minting | retained-page ordering and boundary stability; typed upload and attachment; live feed observation; thumbnail/display delivery assertions |
| Expo chat | the same lifecycle, minting, bounded polling, cleanup, and receipt machinery; bounded scheduling and cleanup registration for the preflight | zero-config supervised-connect assertions and app round trip; web/native auth and custody expectations; membership/persona shape; conversation surface, send, reply, and reaction observations |

The package may expose a platform helper that reduces a recurring callback's
mechanics, but the call and its product postconditions remain in the app-owned
callback. In particular, Expo's zero-config connection claim stays a named
journey step in the Expo template rather than becoming an automatic package
claim.

#### Runner and builder API

The supported root entrypoint exports the following conceptual v1 surface
(the hand-written `.d.mts` is normative for exact types):

```js
import {
  defineStarterAcceptance,
  runStarterAcceptanceIfMain,
  starterVerifyProfileOptions,
} from '@expo/snapback-acceptance';

export const acceptance = defineStarterAcceptance({
  acceptanceFile: import.meta.url,
  appRoot: import.meta.dirname,
  artifacts,
  paths: {
    listTodos: {
      id: 'list-todos',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: api.listTodos,
      provenance: 'baseline',
    },
  },
  async journey({ paths, step, until, defer, mintSession, ready }) {
    await step(paths.listTodos, async () => {
      // The query and every application assertion stay here.
      return { rowCount };
    });
  },
});

await runStarterAcceptanceIfMain(import.meta, acceptance);
```

`operation` accepts a generated operation reference object and the builder
derives its exact id. The builder requires the reference's
`artifactKind: 'functionReference'`, generated function kind, app id, and
complete `expectedGeneration` to match the supplied artifact index; an object
with only a copied `id` is not a reference. It never accepts an app-authored
raw function-id string. `step(pathToken, callback)` accepts only the exact
token object issued by that acceptance definition — not a string, structural
clone, or token from another definition — and records the token's operation as
observed only after the bounded callback and its assertions succeed. A
non-operation product or delivery claim declares `operation: null`, uses its
builder-issued journey-path token and the same bounded callback, and is not
projected as operation evidence. Every declared path id must have one passed
step at journey end; a short journey cannot emit a passing receipt. Arbitrary
output from a callback is rejected unless it is bounded JSON-safe detail. The
app never constructs `snapback.starter-acceptance.*` JSON.

The runner has one `overallTimeoutMs` deadline. It reserves
`cleanupTimeoutMs` from that total, aborts preflight/lifecycle start/journey at
the execution boundary, and bounds cleanup callbacks, client inspection, and
lifecycle stop inside the reserved remainder. Lifecycle start/stop, the
journey, each step, retry predicates and waits, session-mint subprocesses,
client inspection, and cleanup callbacks receive an `AbortSignal`; managed
children are killed on abort, and public adapters/callbacks must honor the
signal for asynchronous work. A timeout wrapper must abort the signal it
passed to the underlying operation, not merely reject a detached race. A
caller-supplied retry signal composes with rather than replaces the active
step/execution signal. TERM, INT, or another external abort cancels execution
at once but does not abort cleanup's own controller: cleanup receives a fresh
deadline over the reserved cleanup remainder. Cleanup callbacks and client
inspection share that bounded controller, but `lifecycle.stop` is invoked
exactly once through an independent bounded last-chance controller even when
the shared cleanup signal is already aborted. When no reserve remains, the
stop signal aborts immediately so the managed adapter takes its terminal kill
path instead of leaving the child alive. This guarantee applies after both an
external abort and the runner's overall timeout.

The verify config imports the same declaration and composes it with D5:

```js
import { defineStarterVerifyProfile } from '@expo/snapback-cli/verify';
import { starterVerifyProfileOptions } from '@expo/snapback-acceptance';
import { acceptance } from './acceptance.mjs';

defineStarterVerifyProfile(starterVerifyProfileOptions(acceptance, {
  id: 'react-live',
  title: 'React starter live acceptance',
}));
```

`starterVerifyProfileOptions` derives `paths`, generated `functionId` values,
the provenance baseline, the acceptance file, and the package runner bytes
from that declaration. Therefore registration and observation share the same
path token and generated reference. The package's receipt projector and the
CLI adapter's receipt validator are the same package-owned compatibility
implementation, so adding or changing a verifier receipt field changes the
package and its verifier consumer, not every application acceptance file.

The package also owns the unsupported-provenance starter conformance projection
currently produced by the CLI adapter. That projection stays explicit: a
successful starter path is identity-bound observation, not complete D1
read/write provenance.

Admission is correlated by path, never collapsed to a set of function ids. For
every registered operation path `p`, a passing receipt requires both
`operations[p.id] === p.functionId` and a passed `checks[]` member whose id is
exactly `p.id`. For every `operation: null` path, the exact passed check is
required and no operation evidence is inferred. Thus two paths that reference
one generated function remain two independent evidence obligations.

#### Authority and compatibility boundary

This package is **not a second proof authority**. Direct execution remains the
raw `npm test` debugging path. The package emits one bounded profile result;
only LLP 0146 D2's `snapback verify` composes artifact freshness, runtime
readiness, admission, capabilities, registered profiles, `next[]`, and the
aggregate receipt. The package must not use `passed` to claim product
completeness or publication qualification.

The public compatibility contract is:

- declaration fields, generated-reference path tokens, `step`, `until`,
  `defer`, `mintSession`, `starterVerifyProfileOptions`, and the v1 lifecycle
  adapter interface are supported root exports; context additions are
  additive, while removals or semantic changes require a package major;
- custom steps and cleanup resources extend the default runner without
  changing profile or receipt authority;
- a custom lifecycle implements the versioned `StarterLifecycleAdapterV1`
  start/readiness/stop and AbortSignal contract. Cleanup remains
  runner-supervised and bounded. Only `lifecycleEvidence` facts the adapter
  actually supplies are stamped; the runner does not invent `owned`,
  `waitLevel`, or `firstQueryRetries`. Package `mintSession` is specifically
  managed-CLI-shaped and requires the adapter to expose that CLI's executable,
  ready file, and admin token; other lifecycles mint for themselves;
- a process-ejected runner may keep the declaration/profile builder and call
  the same-release public receipt projector/parser/validator. It owns process
  lifecycle and cleanup while retaining package/CLI receipt rotation;
- a complete package ejection that independently emits the accepted
  `snapback.starter-acceptance.v1` contract forfeits same-release receipt
  rotation and assumes lifecycle, deadline/child cancellation, cleanup,
  receipt migration, and CLI-pinning responsibility;
- in both ejection cases `defineStarterVerifyProfile` remains the admitting
  authority;
- deep imports, child-process layout, temp filenames, log formatting, and raw
  receipt-object members are not extension points. Templates pin the
  acceptance package to the same Snapback release as the CLI so the builder
  and adapter rotate together.

This ruling resolves Open Question 3's entrypoint and ownership decision. It
does not automatically resolve D5's product-policy questions about the default
visibility of unclaimed generated operations.

## Compatibility and migration

This RFC synthesizes existing safety and evidence boundaries into an authoring
rule; it does not supersede LLP 0108, LLP 0123, LLP 0146, LLP 0189, LLP 0231,
or LLP 0245, and author acceptance is required before its classification or
rollout becomes normative — with one carve-out: D8's classification is the
LLP 0295 D0.3 ruling and carries that ruling's adopted-may-revise status on
its own, and D9 carries the 2026-08-22 public-entrypoint ruling and guardrails,
while every other section keeps this paragraph's Draft posture.
Until each owner adopts its rule it is additive:

- Existing explicit result contracts remain valid and authoritative.
- Existing runtime-readiness receipts and `runtime-qualify` commands remain
  valid.
- Existing verify configurations continue to run.
- Existing implicit table visibility follows the warning-to-error migration
  LLP 0231 adopts from LLP 0172's trajectory; this RFC does not accelerate or
  relax it.
- The write-posture migration warning
  (`SNAPBACK_TABLE_WRITE_POSTURE_MIGRATION_PENDING`) stays owned by LLP 0264's
  phase plan as amended by LLP 0274; this RFC classifies write posture as a
  policy decision and leaves that migration untouched.
- Existing zero-profile verification keeps its distinct nonclaim status.

Where an effective plan-derived result becomes available, generated output may
improve from `unknown` to an exact type. That is a consumer-visible type
improvement and must carry normal generated-artifact identity and compatibility
review. It must not silently change the runtime payload.

## Rollout

1. **Freeze the taxonomy and measurement.** Add a first-use ceremony report to
   the existing template/cold-install harness and rerun the Bugboard brief as a
   retained baseline.
2. **Close template hygiene.** Fix the React template's TypeScript closure and
   make the packed cold-install gate prove it.
3. **Derive closed-plan results.** Implement D3 for the unambiguous return
   forms, project provenance, and remove duplicate contracts from first-party
   templates.
4. **Make qualification automatic.** Implement D4 for packaged local targets,
   preserving exact receipts and failure diagnostics.
5. **Unify proof path identity.** Implement D5, migrate first-party template
   profiles, and add stale/unclaimed diagnostics.
6. **Update the Guide and rerun controls.** The start packets teach the
   classification in one paragraph; fresh npm React CRUD and held-out controls
   measure time, manual declarations, commands, and correction loops against
   the retained baseline.

Rollout steps may land independently. No step may wait for all four classes to
be implemented before improving its own golden path.

### Implementation tickets

- `issues/closed/20260817-react-template-typecheck-node-types.md` — close the concrete
  React template hygiene failure found by Diary 0091.
- `issues/20260817-0275-derive-closed-plan-result-contracts.md` — implement D3.
- `issues/20260817-0275-auto-qualify-packaged-runtime-in-prove.md` — implement
  D4.
- `issues/20260817-0275-single-source-verify-path-registration.md` — implement
  D5.
- `issues/20260817-0275-first-use-ceremony-budget-harness.md` — implement D6/D7
  and retain the before/after measurement.

## Acceptance

- A fresh packed React scaffold passes install, typecheck, build, dev startup,
  and `prove` without source-checkout dependencies or a manual runtime
  qualification command.
- A public bug table still requires an explicit public-read policy; removing it
  follows LLP 0231's declared migration behavior and never infers one.
- A plan returning its inserted typed ID or changed-row count generates the
  same exact runtime contract and client type without a duplicate `result:`
  block.
- A JavaScript handler with an ambiguous return does not gain an inferred
  runtime contract; it receives an LLP 0245 suggestion or remains explicitly
  unknown.
- `prove` on a missing or invalid runtime receipt runs or validates the exact
  required behavioral qualification and retains a digest-bound receipt; a
  failed probe cannot proceed.
- A renamed starter operation makes its old registered path stale and the new
  operation unclaimed until the author updates the product journey.
- A zero-profile app can run and receive the existing
  `passed-without-acceptance` platform verdict, but no UI, CLI, or documentation
  calls it journey-proven.
- The fresh npm Bugboard rerun records fewer manual fact declarations and
  prerequisite commands with no weaker visibility, type, runtime, or evidence
  verdict.

## Risks

- **Automation can look like authority.** Effective projections must name
  `authored`, `plan-derived`, or `unknown`; policy decisions never use the
  plan-derived lane.
- **Auto-qualification can hide expensive or unsafe work.** The probe must be
  bounded, target-aware, digest-cached, and visible in machine receipts and
  verbose output.
- **Generated proof registration can create vacuous confidence.** D5 permits
  identity generation and stale detection, not automatic evidence from
  operation existence.
- **Template convenience can become template magic.** Generated configuration
  remains inspectable, and the normal commands expose exact stage receipts.
- **Exact result derivation can widen accidentally.** Only closed proof rules
  are admitted; partial expression inference fails closed rather than producing
  a broad validator.

## Non-goals

- Inferring authorization, visibility, effects, retention, or public exposure.
- Making acceptance profiles mandatory for local prototyping.
- Claiming product completeness from `snapback verify`.
- Removing standalone diagnostic or operator commands.
- Treating TypeScript's ambient inferred type as the runtime contract.
- Reducing ceremony by weakening generated identity, runtime validation, or
  LLP 0189 claim gates.

## Open questions

1. Should `snapback verify` auto-run qualification by default, or should the
   packaged runtime resolver materialize the local receipt during install or
   first startup so verify only validates it?
2. Should plan-derived exact results be emitted only as generated effective
   contracts, or should LLP 0245 offer a source-freezing patch for consistency
   with opaque handlers?
3. **Ruled 2026-08-22:** D9 pins the public
   `@expo/snapback-acceptance` root entrypoint. One declaration supplies
   builder-issued path tokens backed by generated operation references to both
   bounded journey steps and `starterVerifyProfileOptions`; application source
   never assembles receipt JSON. The eject/extend and non-authority boundaries
   in D9 bind the implementation.
4. Should unclaimed generated operations be quiet by default and visible only
   in `prove --verbose`, or should first-party templates surface them after the
   starter operation set changes?
5. Which ceremony-budget thresholds should block a template release versus
   create a fix-forward ticket?

## Revision history

- 2026-08-17 r1: initial draft (Charlie Cheever / Codex).
- 2026-08-17 r2: revision pass (Claude) — corrected citation authority (the
  visibility migration is LLP 0172's trajectory adopted by LLP 0231; LLP 0123
  is Research; LLP 0146 is Draft), named `prove` as the templates'
  pre-configured `snapback verify`, marked the D3 provenance projection as new
  manifest surface, and recorded the LLP 0264/0274 write-posture boundary.
- 2026-08-21 r3: LLP 0295 D0.3 amendment (Claude) — added D8, the
  fact-by-fact Explicit-profile classification (with the outside-taxonomy
  product-semantics and authored-because-underivable kinds named for
  exhaustiveness) and the W3 Explicit economy lane registration with its
  fixture receipts; recorded the Compatibility carve-out that D8 carries the
  D0.3 ruling's status while the RFC's other sections remain Draft.
- 2026-08-22 r4: author ruling — added D9, selecting the public
  `@expo/snapback-acceptance` root entrypoint, inventorying the four template
  harnesses, pinning the generated-reference/bounded-callback builder API,
  retaining app-owned product meaning, and defining the eject/extend and
  no-second-authority boundaries; resolved Open Question 3.
- 2026-08-22 r5: hostile-review reconciliation — made D9's generated-reference
  and builder-token identity exact, specified path-keyed admission and complete
  declared-path execution, added the total deadline/cancellation contract, and
  separated lifecycle extension, projector-retaining process ejection, and
  complete package ejection with honest evidence and compatibility ownership.
- 2026-08-22 r6: delta-review reconciliation — made completeness explicitly
  passed-per-path, composed retry-local and execution cancellation, and stated
  that external abort preserves the fresh reserved cleanup deadline through
  managed-child termination.
- 2026-08-22 r7: terminal-cleanup reconciliation — gave lifecycle stop an
  independent bounded last-chance controller so callback reserve exhaustion
  cannot suppress its once-only managed-child termination on either external
  abort or overall timeout.
