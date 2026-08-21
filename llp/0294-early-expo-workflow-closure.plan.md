# LLP 0294: Early Expo workflow closure

**Type:** Plan
**Status:** Draft
**Systems:** Expo, Templates, CLI, Verification, Assets, Notifications, Auth,
Client integration, Scheduled work, Guide, Developer experience, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-19
**Revised:** 2026-08-21 (reconciled the complete Messtimate 0.1.24 feedback
summary against current main; added guest entry, native crypto, binding refresh,
asset-guide parity, capability-link/scheduled-work recipes, proof-warning,
acceptance-harness, type-coupling, and field-masking routes without creating
competing subsystem owners.)
**Revised:** 2026-08-21 (OQ5 resolved by orchestrator ruling under LLP 0196:
keep `test` and `test:static`, remove the redundant template `test:live` alias,
and require a manifest-checked script glossary.)
**Revised:** 2026-08-19 (initial draft from early-user feedback)
**Related:** LLP 0041, LLP 0044, LLP 0045, LLP 0146, LLP 0176, LLP 0181,
LLP 0196, LLP 0259, LLP 0275, Diary 0091,
issues/20260819-verify-starter-receipt-field-diagnostics.md,
issues/20260819-expo-web-carrier-supervised-origin.md,
issues/closed/20260819-template-script-surface-glossary.md,
issues/20260819-expo-everyday-simulator-launch.md,
issues/20260819-heic-image-normalization.md,
issues/20260819-minimal-expo-starter.md,
issues/20260819-readme-notifications-capability-overclaim.md,
issues/20260821-guide-gap-asset-client-accessor-mismatch.md,
issues/20260821-guest-session-client-entry.md,
issues/20260821-expo-native-auth-crypto-adapter.md,
issues/20260821-expo-supervised-binding-refresh.md,
issues/20260821-guide-gap-capability-link-app-flows.md,
issues/20260821-starter-verify-provenance-warning.md,
issues/20260821-0275-acceptance-harness-library.md,
issues/20260821-0235-field-masking-productization.md,
issues/20260821-authority-independent-type-coupling.md,
issues/20260821-guide-gap-scheduled-status-flips.md

## Summary

Early Expo users found a product with strong primitives but an uneven first-use
shape. A simple app was easy to scaffold, and several requested workflows
already existed: supervised Expo development, an executable simulator carrier,
one-command image upload and attachment, an S3-compatible local byte-store
lane, and a complete in-app message send. Yet users either did not discover
those paths or encountered first-party commands that contradicted them. Other
requests — HEIC normalization, a domain-neutral Expo starter, ordinary
simulator launch, and first-class notifications — are genuine gaps.

This Plan closes the feedback without treating every complaint as the same
kind of work. It classifies each observation as one of:

1. **shipped capability, missed path** — repair placement, naming, or the
   template's default task;
2. **shipped command defect** — fix the command and retain an end-to-end
   witness;
3. **missing product workflow** — design and implement under the subsystem's
   existing LLP owner; or
4. **ambiguous request** — establish whether the user means an existing
   in-app workflow or a distinct external effect before scheduling capability
   work.

The Plan coordinates existing owners rather than redefining their contracts.
LLP 0275 continues to own proof ceremony and derivable result declarations;
LLP 0181 owns supervised Expo binding; LLP 0196 owns template portfolio and
carrier evidence; LLP 0044 owns media ingestion and byte stores; LLP 0045 owns
email/SMS/push notification delivery.

## Motivation and evidence

The August 2026 feedback set contained three independent reports:

- a spending-tracker build was easy, but the author could not distinguish
  `carry:*`, `prove`, and `test`, and the agent reconstructed simulator launch
  manually;
- a mobile-app author asked for an UploadThing-like photo path, HEIC-to-JPEG
  consistency, and a built-in way to persist messages; and
- Diary 0091's follow-up found a receipt-completeness diagnostic that hid the
  failing field, a manually discovered runtime-qualification prerequisite, a
  structurally unusable Expo web carrier, no domain-neutral Expo template, and
  repetitive declarative mutation-result syntax.

Repository evidence separates misses from gaps:

- since 2026-08-06, `SnapbackExpoProvider` has accepted a real
  `expo-image-picker` asset through a generated command that owns transfer,
  finalization, and attachment;
- since 2026-08-08, `expo-chat` has included a bound text-message mutation and
  composed send command, `media-feed` has demonstrated photo upload, and both
  Expo templates have shipped `carry:native-simulator`;
- since 2026-08-10, supervised Expo web has been a first-class
  `--expo-platform web` selection;
- the template start packet explains `prove` and `carry:*`, but the package
  script list still exposes lower-level aliases without a compact taxonomy;
- the current web carrier still launches Expo through the generic client arm,
  which LLP 0181 explicitly says cannot install the supervised binding origin;
- the starter verifier still collapses its receipt-completeness predicate to a
  boolean and does not report which receipt path failed;
- the local image pipeline detects and rewrites JPEG/PNG but does not ingest
  HEIC or claim general transcoding; and
- the capability registry still reports first-class notifications as
  design-only even though the README advertises email, SMS, and push without a
  maturity qualifier.

The important product lesson is not merely “write more documentation.” When a
workflow is common and mechanically owned by the platform, its cheapest path
belongs in a template command or generated API. Documentation should explain
the boundary and recovery path, not substitute for a working command.

The complete Messtimate summary supplied on 2026-08-21 adds four present-tense
contradictions on current main, not only 0.1.24 historical findings:

- the assets Guide still uses `client.assets.start(...)` in its minimal example
  and later says that exact accessor does not exist;
- `guestPolicy` and the guest mechanism are declarable while the generated
  client lifecycle explicitly excludes guest as an entry mechanism;
- the Expo native auth-custody path still passes `globalThis.crypto` into a
  digest path that requires `crypto.subtle`; and
- the supervised bootstrap exchange serves one one-hour binding indefinitely
  unless another rotation event happens.

It also supplies product-demand evidence for mechanisms whose design already
has an owner: capability links (LLP 0204/0150), field masking (LLP 0235),
scheduled work (LLP 0028/0070), and proof-ceremony reduction (LLP 0275). This
Plan routes and sequences those owners; it does not redefine their security or
evidence contracts.

## Program

### W1 — Make proof commands trustworthy and legible

1. Implement LLP 0275 D4 so the ordinary packaged `prove` path validates or
   acquires the required runtime-readiness evidence without a separately
   discovered `runtime-qualify --persist` command. The standalone command
   remains for diagnosis and explicit requalification.
2. Change starter-receipt validation from one opaque predicate to a
   path-addressed validation result. A refusal must name every missing or
   invalid field needed for repair, beginning with the first actionable path;
   exit 0 plus `status: "passed"` must never be rendered as the apparent cause
   of failure.
3. Apply LLP 0275 D3 for exact declarative-plan return forms so authors do not
   repeat a result contract already proved by `returnBinding`,
   `returnChangedCount`, `returnDocument`, a closed literal, or a fully
   derivable expression.
4. Give every scaffold one short script glossary generated or checked from
   the actual `package.json`. It must state that `prove` is the authoritative
   aggregate, `test` is the raw starter acceptance implementation,
   `test:static` is no-server coherence, `test:live` was removed with an
   explicit migration to `test`, and `carry:*` drives a carrier only after
   accepting the `prove` receipt.
5. Apply the resolved LLP 0196 script-surface ruling recorded in OQ5: keep the
   discoverable raw/static scripts, remove only the redundant live alias, and
   drift-check the glossary against command classes in every template.

Direct work is tracked by the two existing LLP 0275 tickets plus
`issues/20260819-verify-starter-receipt-field-diagnostics.md` and
`issues/closed/20260819-template-script-surface-glossary.md`.

### W2 — Make Expo carriers executable, not reconstructable

1. Repair the Expo `web-browser` carrier to use LLP 0181's supervised Expo web
   arm. The carrier must consume the selected Metro/web origin from structured
   readiness rather than require a static origin that forces it back onto the
   generic arm.
2. Retain an installed-package end-to-end witness that a fresh Expo scaffold's
   `carry:web-browser` reaches application readiness, performs a real product
   read/write journey, captures its artifacts, and never renders
   `SNAPBACK_APP_BINDING_UNAVAILABLE` or the supervisor-bypassed advisory.
3. Add an ordinary development command for “run this app on my simulator.” It
   should select or accept an exact simulator, supervise backend and Metro,
   launch the installed carrier, and remain attached for editing. It is not a
   screenshot/proof carrier and should not require the carrier kit's offline
   relaunch ceremony.
4. Keep proof and development lifecycles distinct: `carry:native-simulator`
   retains bounded evidence ownership, while the ordinary command optimizes
   the edit loop and does not mint a product-completeness claim.

Direct work is tracked by
`issues/20260819-expo-web-carrier-supervised-origin.md` and
`issues/20260819-expo-everyday-simulator-launch.md`.

### W3 — Close the mobile photo workflow honestly

The existing generated command remains the default: pass one ImagePicker asset
and let the provider own upload, trusted finalization, attachment, progress,
and settlement. The missing cross-platform normalization becomes a focused
LLP 0044 amendment before implementation.

That amendment must decide:

- whether HEIC decoding occurs in a trusted server processor, a first-party
  Expo source adapter, or a staged combination;
- whether JPEG is the canonical stored primary or a derived rendition while
  the original remains governed;
- metadata/location policy, orientation, color-profile behavior, animation and
  Live Photo treatment, output quality, byte/pixel/time ceilings, and decoder
  isolation;
- how Android and iOS prove equivalent logical results without trusting a
  caller-supplied MIME type; and
- target capability facts and explicit refusals where the decoder is absent.

The first accepted slice must include real iOS HEIC and Android JPEG/PNG
fixtures through the ordinary Expo command and prove a server-detected,
renderable result with no silent picker-empty outcome. It must not turn an
Expo-only client conversion into a platform-wide transcoding claim.

The S3-compatible store remains a target/storage configuration behind the
same asset task. Hosted R2/Tigris/S3 qualification stays with LLP 0044 and the
hosted delivery programs; this Plan does not relabel a local MinIO-qualified
lane as an UploadThing-like hosted product.

Design and execution are tracked by
`issues/20260819-heic-image-normalization.md`.

### W4 — Provide a domain-neutral Expo starting point

Amend LLP 0196's portfolio ruling to admit one **shell**, not another feature
demo: a minimal Expo starter with the generated provider, supervised loop,
sessions-ready posture, one small public live read/write, and no chat, feed,
or dashboard domain to delete. Its purpose is to receive briefs such as a
spending tracker without forcing “right platform, wrong product.”

Before adding it, compare two implementation shapes:

1. a separately named `expo-minimal` template; or
2. a compositional Expo shell/profile shared by `expo-chat` and `media-feed`,
   exposed as a scaffolder option without duplicating package and proof
   maintenance.

Whichever shape is selected must preserve LLP 0196's candidate-package and
published-canary qualification, carry its start packet, and pass fresh
scaffold → install → generate → typecheck → supervised development → prove.
The template must not improve apparent simplicity by omitting auth, runtime,
or acceptance checks.

Tracked by `issues/20260819-minimal-expo-starter.md`.

### W5 — Separate in-app messaging from external notifications

“Send a text and save it to my backend” is ambiguous:

- if it means an in-app chat message, `expo-chat` already provides the desired
  one-command path; the action is to make template selection and generated
  command discovery succeed before an agent concludes the feature is absent;
- if it means SMS, LLP 0045's first-class notification capability is still
  design-only and must not borrow readiness from the local Expo push seam.

Do not commission SMS implementation from this single ambiguous report.
First, ask for the intended effect in the next user study and record whether
the demand is in-app persistence, transactional SMS, conversation bridging, or
both. If SMS is confirmed, extend LLP 0045 with provider selection,
credentials, consent, opt-out, sender identity, delivery receipts,
idempotency/ambiguity, capture adapters, and local-versus-hosted posture.

Independently, repair public wording now: the README must distinguish shipped
local Expo push from design-only first-class email/SMS/push. Tracked by
`issues/20260819-readme-notifications-capability-overclaim.md`.

### W6 — Make native auth entry and long dev sessions self-sustaining

Three defects compose into the native first-use boundary:

1. Implement LLP 0214's declared guest-creation transition through the
   framework-neutral application client and project it through React/Expo under
   LLP 0258's existing coordinator. A declared `guestPolicy` must either have a
   usable entry or be described as server-design-only; the current split is not
   acceptable.
2. Resolve the auth-custody partition digest through a provider-owned Expo
   crypto adapter. Binding-digest fallback and security-bearing randomness
   remain separate facts: a SHA-256 adapter does not create a CSPRNG.
3. Refresh supervised AppBindings before expiry. The supervisor must remain the
   issuer and preserve its generation/descriptor/route boundary; the app must
   not paper over expiry by extending timestamps locally.

The guest route is a security-bearing feature and waits for its owner review.
The crypto and binding-refresh defects are straight repairs and should proceed
first with packed native witnesses. Tracked by
`issues/20260821-guest-session-client-entry.md`,
`issues/20260821-expo-native-auth-crypto-adapter.md`, and
`issues/20260821-expo-supervised-binding-refresh.md`.

### W7 — Turn shipped primitives into discoverable application workflows

1. Correct the assets Guide/API contradiction immediately and compile the exact
   snippet against packed packages. This is a current docs defect, not a design
   debate.
2. Teach the shipped anonymous-set capability-link journey end to end, including
   Expo deep-link parsing, inert GET, explicit invocation, expiry/revocation,
   and the boundary before granted-operation or identity-bearing links.
3. Add a scheduled-expiry/status-flip recipe over cron action -> bounded
   mutation, with one-off-job and notification-delivery boundaries named.
4. Make starter provenance limitations a declared receipt nonclaim instead of
   an unactionable warning repeated on every green run.
5. Extract common acceptance lifecycle/receipt plumbing into one supported
   runner after LLP 0275 D5 supplies the single operation identity. Application
   journey intent and assertions stay app-authored.

Tracked by `issues/20260821-guide-gap-asset-client-accessor-mismatch.md`,
`issues/20260821-guide-gap-capability-link-app-flows.md`,
`issues/20260821-guide-gap-scheduled-status-flips.md`,
`issues/20260821-starter-verify-provenance-warning.md`, and
`issues/20260821-0275-acceptance-harness-library.md`.

### W8 — Route cross-cutting authoring demands to their existing owners

The feedback also validates two non-Expo product directions without granting
this Plan authority over them:

- conditional field disclosure is real app demand, but LLP 0235 already owns
  the security contract. Prioritize its review and smallest claimable slice;
  do not ship a projection-only `maskField` convenience ahead of its
  noninterference and physical-plan gates; and
- `authorityIndependent: true` plus authenticated-only auth is correctly
  rejected by codegen, but TypeScript should make the exact invalid literal
  pair unrepresentable while retaining runtime validation for JavaScript,
  casts, and version skew.

Tracked by `issues/20260821-0235-field-masking-productization.md` and
`issues/20260821-authority-independent-type-coupling.md`.

## Current-main disposition of the remaining 0.1.24 suggestions

No new ticket is needed for the following observations because current main
already has an owner and a shipped or explicit tracked posture:

- Micro entrypoints are published and documented at
  `@expo/snapback-client/micro`, `./micro/core`, and `./micro/live` under LLP
  0147 and `guide/clients/headless.md`.
- Value-expression arithmetic (`add`, `sub`, `mul`, `div`, `mod`, comparisons,
  conditionals, and `runtimeNow`) is shipped and documented in the declarative
  plans Guide.
- `snapback dev --fresh` is shipped; versioned seed identity remains an
  intentional safety boundary rather than an invitation to delete `.snapback`.
- The local host-op session mint is now explicitly documented as
  non-production; hosted production auth remains a separately named gap, so a
  convenience broker must not imply otherwise.
- React/Expo lifecycle integration already follows `AppState`, pausing and
  resynchronizing the provider; qualified offline mutation custody remains
  tracked by `issues/20260816-qualify-expo-local-first-carrier.md`.
- Expo config plugins and simulator onboarding/dialog automation are shipped
  and documented; the ordinary simulator-launch ergonomics remain W2.
- Secure native auth custody is owned by the first-party custody module under
  LLP 0258; W6's crypto ticket is the remaining digest-adapter defect, not a
  request for a second session store.
- Scheduled execution primitives already ship under cron and durable jobs; W7
  adds the missing product-intent recipe rather than a new scheduler.

## Sequencing

1. Land W1's field diagnostic, W2's web-carrier repair, W7's asset-guide
   correction, and W6's binding/crypto repairs first. They are
   shipped-command defects and should not wait for portfolio design.
2. Land the README honesty correction and starter-warning classification with
   or before those fixes.
3. Complete LLP 0275 D3/D4/D5, the script-surface ruling, and the common-harness
   decision as one first-use
   ceremony wave.
4. Add the ordinary simulator command, guest entry after owner review, and
   retain live installed-package
   witness.
5. Amend LLP 0196 and implement the domain-neutral Expo shell.
6. Land the capability-link and scheduled-work recipes against the shipped
   primitives; they need no new platform authority.
7. Run the HEIC design amendment and implementation only after the processor
   and custody decision is accepted.
8. Review/cost LLP 0235 independently; do not block straight Expo repairs on
   field-masking implementation.
9. Revisit SMS only with clarified demand; hosted object-store rollout remains
   on its existing target program.

## Acceptance

The Plan is complete when all applicable rows pass from packed public-shape
packages outside the repository workspace:

1. A fresh Expo scaffold reaches `bun run prove` with no separately documented
   runtime-qualification command.
2. Mutating a starter receipt to rename or omit an expected field produces a
   diagnostic naming that exact JSON path and expected shape.
3. Every starter exposes one authoritative proof command and a checked script
   glossary; a cold-agent test correctly distinguishes `prove`, `test`, and
   `carry` without reading package source.
4. `carry:web-browser` uses supervised Expo web, reaches application readiness,
   completes a real UI journey, and retains screenshot/DOM/process artifacts.
5. One ordinary command launches a selected iOS simulator into a live editable
   app without requiring manual port extraction or deep-link construction.
6. A domain-neutral Expo scaffold supports a held-out CRUD-shaped brief without
   deleting chat/feed domain code and passes its complete first-use sequence.
7. The accepted HEIC slice passes real iOS HEIC and Android control fixtures
   through the ordinary generated command, with trusted detected output,
   bounded processing, visible failure, and an honest target capability fact.
8. README, Guide, capability registry, and template wording agree on which of
   in-app messages, Expo push, email, and SMS ship on each target.
9. A rerun of the original feedback tasks records which former misses now land
   on the intended template/command without package-source archaeology.
10. A guest-enabled app can enter through the ordinary application client, or
    the declaration is narrowed until that route ships; schema and client entry
    may not disagree.
11. Fresh native auth boot requires no app-installed crypto global, and a
    supervised loop survives multiple binding TTLs and cold boots.
12. The asset minimal-path snippet compiles against packed packages; capability
    links and scheduled expiry each have a cold-retrievable executable recipe.
13. A green starter proof emits no warning the application author cannot act
    on, while retaining an honest provenance grade.
14. LLP 0235 has an explicit accepted/shelved product ruling informed by the
    phone-field case; no unsafe masking convenience ships in advance.

## Non-goals

- Replacing LLP 0275's ceremony taxonomy or proof decisions.
- Replacing LLP 0181's AppBinding or supervised Expo security boundary.
- Claiming hosted object storage from the local S3-compatible qualification.
- Adding arbitrary media transcoding, video pipelines, or unbounded custom
  processors under the HEIC slice.
- Treating carrier screenshots as acceptance receipts.
- Implementing SMS before the reported meaning of “text message” is clarified.
- Hiding security, auth, delivery-policy, or evidence decisions in a minimal
  template.
- Inventing an Expo-only auth/session owner instead of projecting LLP 0258.
- Treating an Expo crypto digest adapter as secure-randomness authority.
- Replacing LLP 0235's masking contract with client-side projection redaction.
- Relabeling the local `auth.mintSession` host op as a production session broker.

## Open questions

1. Should the ordinary simulator command be a template script (`dev:ios`), a
   CLI flag that launches the selected carrier, or both projections of one
   owner?
2. Does the minimal Expo shell become the `create-snapback-app` default, or
   remain an explicit choice while `expo-chat` retains the worked-example
   default?
3. Is canonical JPEG required, or is a JPEG primary rendition beside a
   retained HEIC original the better custody and export contract?
4. Did the notification feedback mean SMS, in-app chat, or a composed workflow
   in which one durable message optionally fans out to SMS?
5. **Resolved 2026-08-21 under LLP 0196 — starter script names.** Keep `test`
   and `test:static` as top-level scripts: breaking bare `npm test` raises
   discovery cost and breaks the cold-install proof, which runs it three
   times. Remove `test:live` from all five templates because it was a
   byte-identical alias of `test` with no consumer beyond equality assertions;
   migrate callers to `npm test`. Every template README and start packet must
   carry a `package.json`-derived or drift-checked glossary: `prove` is the
   only done-oracle and its authoritative aggregate `snapback verify` receipt
   is acceptance evidence, not formal proof; `test` is the raw acceptance
   implementation for debugging; `test:static` is no-server coherence; and
   `carry:*` retains observation artifacts only after accepting the `prove`
   receipt, never as proof authority.
6. Should guest entry be a method on the generated application auth facade, a
   coordinator method projected into hooks, or both views of one owner?
7. Should supervised bindings refresh lazily per exchange or proactively on a
   supervisor timer? Which choice makes concurrent cold boots and fake-clock
   tests simplest without creating background lifecycle work in the app?
8. Does the common acceptance runner remain template-internal first, or is its
   compatibility contract stable enough for a public package entrypoint?
