# Handler-sandbox findings: triage, product exposure, and scheduling

**Status:** Open
**Filed:** 2026-08-20
**Systems:** Runtime, Security/authorization, Ibex/Hermes, Codegen
**Related:** LLP 0009, LLP 0292, LLP 0283 F-1, LLP 0240, LLP 0244, and the five findings
filed 2026-08-19 (host-response `JSON.parse`, `__snapbackHandlers` registry substitution,
Ibex single-Script declaration instantiation, `Array.prototype.slice` role laundering,
ambient `.then` provenance theft)

## Why this exists

Five handler-sandbox findings were verified and filed on 2026-08-19 and never scheduled.
They differ in kind from LLP 0283 F-1: F-1's threat model is Attacker C, *a module inside an
already-trusted Rust crate*. **These are reachable from application handler JavaScript**, so
they govern whether the product is safe to *use* today — a different question from whether it
is safe to *publish*.

## The product exposure answer, stated precisely

> An app author who trusts all handler source and dependencies, and whose handlers do not
> modify globals, prototypes, or the handler registry, is not automatically exposed to a
> remote user merely by using Snapback. Ordinary request input cannot trigger these without
> application JavaScript cooperation.
>
> However, Snapback currently **cannot treat handler JavaScript as an adversarial security
> principal**. A hostile or compromised handler can bypass generated membership admission,
> including changing an authorization denial into an allow. Several findings can also be
> triggered **accidentally** by polyfills or prototype/global monkey-patching in otherwise
> well-intentioned code.

That last clause matters and narrows earlier informal guidance: "trust your own handlers" is
not sufficient, because a dependency's polyfill can trip these without anyone intending it.

This falls short of the application-code security boundary LLP 0009 intends.

## Author ruling 2026-08-20 — not a blocker for pre-public-release npm

**The next npm closures do NOT assert adversarial-handler containment.** Charlie Cheever ruled
that this boundary is *"eventually yes, but not for pre-public-release npm releases."*

Consequences, in the order they bind:

1. **These five findings are NOT publication blockers for pre-public-release closures.** They
   do not gate the next npm release, and they should not be treated as gating one.
2. **The release claim must EXPLICITLY DISCLAIM the boundary.** This is the load-bearing half
   of the ruling. Leaving it unstated is not the same as not claiming it: a closure that is
   silent on handler containment will be read as asserting it, particularly by the agents
   LLP 0041 names as the expected audience. The disclaimer must say plainly that application
   handler JavaScript is not treated as an adversarial security principal in this release.
3. **They remain open work, not accepted risk.** Before any release that DOES assert the
   boundary — a public release — these must be closed and qualified on both engines. The
   ruling defers the assertion; it does not retire the findings.
4. **The "safe to use" guidance below is unaffected.** It describes what is true of the
   product, not what a release claims, and it stays accurate: a hostile or compromised handler
   can bypass generated membership admission, and several findings can be tripped
   *accidentally* by polyfills or prototype monkey-patching in well-intentioned dependencies.

The scheduling judgment below was written before this ruling. Its *engineering* reasoning
still holds — the durable registry fix overlaps LLP 0292's exact-operation registry and should
be designed with it rather than built twice. What changes is urgency: this is no longer on the
critical path to the next npm closure.

## Scheduling judgment

**Fix alongside LLP 0292, front-loaded ahead of its Phase 3 authority reconnection, and ahead
of any "safe to use" claim.**

- **Not after 0292** — it limits itself to Rust authority creation and does not redesign the
  JS runtime or harness, so completing it would leave these live.
- **Not serially before all of 0292** — the durable registry/admission fix overlaps 0292's
  exact-operation registry and should be designed with it, rather than building a temporary
  admission architecture that 0292 then replaces.
- F-1 already blocking publication buys scheduling room, but is **not** a reason to defer
  these.

## One correction to the 2026-08-19 record

The captured-intrinsic dispatcher landed that day protects only the **incoming** invocation
payload. It does **not** protect native host-response decoding, and sealing the `globalThis`
lookup root is irrelevant to it, because Ibex asks the realm for `JSON.parse` directly. The
host-response finding is therefore still fully live on Ibex — though verified **not** present
on the equivalent Workerd path.

---

No files were changed. I assessed all five listed findings, although the prompt initially says four.

## Scheduling judgment

Fix these **alongside LLP 0292, but front-load them ahead of its authority reconnection and ahead of any “safe to use” claim**.

- **Not after LLP 0292:** LLP 0292 explicitly limits itself to Rust authority creation and does not redesign the JS runtime or harness (`llp/0292-authority-kernel-rebuild.plan.md:60-87`). Completing it would leave these findings live.
- **Not serially before all LLP 0292 work:** the durable registry/admission solution overlaps LLP 0292’s exact-operation registry and should be designed with it, avoiding a temporary admission architecture.
- **Alongside:** start the upstream Ibex work and harness fixes immediately while LLP 0292 proceeds. Require closure before Phase 3 reconnects generated authority consumers (`llp/0292-authority-kernel-rebuild.plan.md:316-332`).
- F-1 already blocking publication provides scheduling room, but it is not a reason to defer these: F-1 concerns malicious Rust crate code; these findings determine whether application handler JavaScript is safely containable today.

The product-level answer is precise:

> An app author who trusts all handler source and dependencies, and whose handlers do not modify globals, prototypes, or the handler registry, is not automatically exposed to a remote user merely by using Snapback. Ordinary request input cannot trigger these without application JavaScript cooperation.  
>  
> However, Snapback currently cannot treat handler JavaScript as an adversarial security principal. A hostile or compromised handler can bypass generated membership admission, including changing an authorization denial into an allow. Several findings can also be triggered accidentally by polyfills or prototype/global monkey-patching in otherwise well-intentioned code.

That falls short of LLP 0009’s intended application-code security boundary (`llp/0009-code-execution-security.rfc.md:38-48`, `839-850`).

Effort bands below mean: **S** ≤2 engineering days, **M** 3–7 days, **L** 1–3 weeks or cross-repository delivery/qualification.

## Finding-by-finding audit

### 1. Host response decoded through replaceable `JSON.parse` — Critical

**VERIFIED — live on Ibex. Not present in the equivalent Workerd response path.**

The pinned Ibex implementation obtains `global.JSON`, then dynamically obtains and calls its `parse` property after application code has run: `vendor/ibex/src/engine/hermes_runtime.cc:16120-16128`. Both synchronous and asynchronous bridges use this decoder at `hermes_runtime.cc:16244-16259` and `16383-16390`. Snapback still sends host results using the `+json` response form at `crates/snapback-engine/src/runtime/host_glue.rs:6112-6115`.

The August 19 captured-intrinsic dispatcher only protects the opposite direction: decoding the incoming invocation payload with `trustedJsonParse` at `packages/snapback-harness/ctx-bootstrap.js:1834-1854`. It does not protect native host-response decoding. Sealing the `globalThis` lookup root is also irrelevant because Ibex directly asks the realm for `JSON.parse`.

Workerd captures JSON/response operations before application import in `packages/snapback-harness/workerd/strip.mjs:36-79` and uses the captured response decoder in `workerd/handler-server.mjs:475-490`.

**Exploiters and app shape:** any Ibex handler can replace `JSON.parse`. The authorization flip requires a protected generated query whose membership denial is represented as JSON `false`; generated queries use a nonterminal role check before returning an empty result on denial (`llp/0240-generated-admission-and-authority.spec.md:248-257`). A mutation’s terminal host error takes a different response branch. Accidental JSON monkey-patching can corrupt other host results even without hostile intent.

**App-author cost today:** a hostile handler behind a generated protected query can turn host `false` into JavaScript `true`, exactly as reproduced in the ticket (`issues/20260819-host-response-decoded-with-replaceable-json-parse.md:29-33`). Trusted handlers that leave `JSON.parse` alone are unaffected.

**Fix:** capture the decoder inside `ExactHermesRuntime` before any application evaluation—or, preferably, decode host responses entirely outside the application realm. Apply it consistently to sync and async bridges.

**Cost:** M implementation, but **L delivery risk** because the source belongs to the `vendor/ibex` submodule: upstream Ibex change/review, Snapback gitlink advance, runtime bootstrap, rebuilt artifacts, and Hermes qualification are required. This lane should start first because it has the longest lead time.

### 2. Handler-registry admission substitution — Critical

**VERIFIED — live. August 19 hardening only partially narrowed it.**

Generated membership wrappers and their underlying exports remain entries in the application-visible `globalThis.__snapbackHandlers` registry (`packages/snapback-codegen/index.mjs:9075-9098`). Dispatch selects the entry from that mutable registry at `packages/snapback-harness/ctx-bootstrap.js:1523-1524`. Both `Proxy` and `__snapbackHandlers` remain allowed surface in `packages/snapback-harness/allowlist.json:93-110` and `161-169`.

The sealed root at `ctx-bootstrap.js:164-183` prevents a late `globalThis` redirect, but it does not make the registry or its properties host-owned. A current-tree in-memory harness probe confirmed that a Proxy can return the underlying handler when dispatch requests the admission wrapper; the handler ran without the expected permissions call.

Workerd loads the trusted harness before the application module (`packages/snapback-harness/workerd/entry.mjs:1-10`), but the later application still shares the exposed registry, so import ordering does not close this substitution.

**Exploiters and app shape:** primarily hostile handler/module initialization code. It requires a generated membership-admission wrapper or another security-sensitive wrapper registered beside an underlying export. Accidental registry mutation can misroute handlers, but targeted admission bypass is deliberate.

**App-author cost today:** generated admission is not a defensible boundary from the handler it wraps. Apps without generated membership admission are not exposed to this particular authorization bypass.

**Fix:** do not let JavaScript select whether the admission wrapper runs. The host should derive admission from the generated operation manifest or exact operation identity before dispatching application code. Then make handler selection private/final after registration. Merely freezing the current map is insufficient because a Proxy can lie during reads.

**Cost:** M–L. This needs its own security design but should share LLP 0292’s exact-operation registry and authority vocabulary.

### 3. Single-script declaration instantiation shadows globals — Critical

**VERIFIED — live on Ibex; structurally absent from Workerd.**

Ibex still concatenates ambient declarations, allowlist, trusted bootstrap, application source, and invocation tail into one script at `crates/snapback-engine/src/runtime/host_glue.rs:6119-6132`. Preflight uses the same single-script structure at `host_glue.rs:5520-5555`.

ECMAScript declaration instantiation occurs before the bootstrap’s first statement. Consequently, an application declaration such as `function globalThis(){}` can replace the lookup used by the bootstrap before `ctx-bootstrap.js:164-183` attempts to seal it. The late invocation tail also resolves through `globalThis` (`packages/snapback-harness/invocation-iife.js:1-4`). Thus, the sealed-root hardening does not close the ticket; it can seal the attacker-selected object.

Workerd imports bootstrap modules separately from the application module (`workerd/entry.mjs:1-10`), so this exact single-script defect is Ibex-specific.

**Exploiters and app shape:** any Ibex handler source can declare conflicting globals. The full authorization exploit is deliberate and requires recovering the actual realm root, but an innocent top-level declaration named `globalThis` can break the harness. The ticket already records an action-shaped Hermes reproduction (`issues/20260819-ibex-single-script-declaration-instantiation-shadows-globals.md:41-50`).

**App-author cost today:** normal handlers that do not declare bootstrap-sensitive global names are unaffected. Hostile Ibex handler source can compromise the bootstrap before its protections exist.

**Fix:** evaluate trusted ambient/bootstrap code in a distinct script first, application source second, and invocation tail third. The design must preserve source mapping, deadlines, queued rejection handling, and preflight/runtime equivalence.

**Cost:** M. This needs its own Ibex lifecycle design and regression suite; it should not be hidden inside LLP 0292.

### 4. Generated role checks launder roles through `Array.prototype.slice` — High

**VERIFIED — live, with an unused captured intrinsic already available.**

Bootstrap captures a trusted slice function at `packages/snapback-harness/ctx-bootstrap.js:41-43`, but both permission methods still call ambient `Array.prototype.slice.call` at `ctx-bootstrap.js:1331-1346`. Code generation passes the intended roles at `packages/snapback-codegen/index.mjs:9085-9089`, while Rust validates only that received roles are nonempty and belong to the vocabulary at `crates/snapback-engine/src/runtime/host_glue.rs:4298-4332`.

A current-tree harness probe changed an intended `["owner"]` check into `["member"]`; the resulting host request was admitted. Neither August 19 hardening affected this path.

**Exploiters and app shape:** generated membership admission with distinguishable roles, such as owner versus member. A hostile handler can poison `Array.prototype.slice`; a well-intentioned handler or dependency can also trigger it through broad prototype monkey-patching.

**App-author cost today:** an attacker who can alter handler JavaScript and already has a weaker valid role can turn a denial for a stronger role into an allow. Apps that do not use generated role admission are not exposed to this finding.

**Fix:** immediately use the already captured slice through trusted `Reflect.apply`, or copy the arguments without consulting application prototypes. Audit sibling plan/filter/order copying for the same mistake. Structurally, the host should eventually derive roles from operation metadata rather than accept a JavaScript-supplied role array.

**Cost:** S for the direct closure and focused audit. The structural role derivation can batch with finding 2.

### 5. Ambient `then` intercepts media results before provenance stripping — Medium

**VERIFIED — live in the shared harness and reproduced for an Ibex-style synchronous host object. Workerd exploitability is INFERRED, not yet runtime-verified.**

Provenance stripping happens in `packages/snapback-harness/ctx-bootstrap.js:618-644`, but `adoptHostResult` first reads `value.then` at `ctx-bootstrap.js:646-650`. Application-controlled inherited accessors or functions therefore run before the private media marker is moved into the WeakMap. The token is later emitted during media handoff at `ctx-bootstrap.js:1541-1558`.

A current-tree in-realm probe installed an inherited `then`, copied the result, and caused the copy to produce a valid `media.handoff` occurrence. This violates LLP 0244’s rule that spread/copy/JSON lose media provenance (`llp/0244-media-provenance-and-one-shot-handoff.spec.md:198-205`).

Rust still validates the token and original media identity at `crates/snapback-engine/src/runtime/host_glue.rs:546-618`, so this does not mint a different asset or directly bypass row authorization. It launders provenance onto a structural copy.

**Exploiters and app shape:** only handlers using media projection/handoff. A hostile handler can install the inherited `then`; accidental prototype pollution can do the same.

**App-author cost today:** apps not using media handoff are unaffected. Media apps cannot rely on “copies lose provenance” when handler code is hostile or prototype-polluted.

**Fix:** distinguish transport results without duck-typing application-visible `.then`. For synchronous Ibex results, strip provenance before any callback/property lookup. For Workerd, observe the canonical promise using captured promise machinery, then strip the resolved object before exposing it. `Promise.resolve(value)` alone is insufficient because it also assimilates attacker-controlled thenables.

**Cost:** S–M, including a Workerd regression.

## Shared root

**VERIFIED:** LLP 0009 already warns that the captured dispatcher and sealed root are necessary but insufficient, naming the mutable registry and single-script bootstrap as remaining holes (`llp/0009-code-execution-security.rfc.md:578-615`).

All five belong to one broad failure family—control-plane logic consuming application-replaceable realm behavior—but no single “capture more intrinsics” patch closes them all:

| Mechanism | Findings it addresses |
|---|---|
| Native pre-app capture or non-JS decoding | 1 |
| Separate trusted and application evaluations | 3; makes later captures trustworthy |
| Actually use captured intrinsics before callbacks | 4 and 5 |
| Host-owned operation/admission metadata | 2 and structural closure of 4 |
| Sealed `globalThis` root | Only late redirection; closes none of these fully |

The durable design is a three-part boundary:

1. Establish the trusted bootstrap in a separate evaluation unit.
2. Keep handler selection and generated admission host-owned.
3. Decode host results and provenance before application code or application-visible property lookup.

That should become an LLP 0009 harness-boundary amendment or a dedicated companion design. It should reference, but not be absorbed into, LLP 0292.

## Prioritized execution plan

1. **P0 — start the Ibex upstream lane immediately.** Fix native response decoding, add denial-to-allow regressions for sync and async bridges, advance the submodule pin, and qualify the rebuilt runtime. This is its own lane because ownership and shipping differ.

2. **P0 — batch the two small shared-harness closures.** Replace ambient role slicing, repair media adoption ordering, and audit adjacent control-plane `.slice`, `.then`, and prototype-method calls. Target S–M total.

3. **P0 — design and implement split Ibex evaluation.** Trusted bootstrap, application source, and invocation tail become distinct evaluation stages. Keep this separate from the native decoder change even if they share final Hermes qualification.

4. **P0/P1 — design operation-owned admission alongside LLP 0292.** The exact operation registry should determine the admission predicate and role set before handler dispatch. Remove authority significance from `__snapbackHandlers`; retain it, if necessary, only as a private implementation table.

5. **Qualification gate before app-use or publication claims.** Exercise both engines against:
   - hostile host-response parsing;
   - Proxy/entry wrapper substitution;
   - pre-bootstrap `function globalThis`;
   - owner-to-member role laundering;
   - inherited-`then` media token theft.

6. **Close tickets only from regression evidence.** Update LLP 0009’s control-plane-boundary section and the affected LLP 0240/0244 acceptance coverage when the fixes land.

## Runtime evidence still needed

Source inspection and in-memory harness probes settle current liveness. What remains unexecuted is end-to-end confirmation in the current Hermes binary and the exact Workerd media behavior. The repository currently lacks focused regression cases that can settle those questions alone.

After adding the regressions, the exact qualification commands should be:

```sh
scripts/bootstrap-ibex-runtime
cargo test -p snapback --test auth_invocation_v1 -- --nocapture
cargo test -p snapback --test workerd_twin_v0 -- --nocapture
node --test packages/snapback-harness/envelope.test.mjs
```

The first command is mandatory before Rust build/test operations in this checkout.
