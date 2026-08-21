# LLP 0261: `snapback init` — composing Snapback into an existing app

**Type:** RFC
**Status:** Accepted
**Systems:** CLI, Templates, React/Expo, Packaging, Code generation, Guide
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-15
**Revised:** 2026-08-21 (e — D0.1 lifecycle cross-reference: LLP 0295 D0.1's
canonical-lifecycle ruling is recorded in LLP 0223's 2026-08-21 dated
amendment; design point 5 ("exit into the ordinary lifecycle") now binds to
that ruled lifecycle, including its fixed-origin/external-client profile and
single ready receipt. Adopted per LLP 0295 default proposal; author may
revise. See the dated amendment.)
**Revised:** 2026-08-16 (d — v1 implementation record: `snapback init` landed
in `packages/snapback-cli` after a three-round dual-family adversarial review
(grok-4.6 xhigh + gpt-5.6-sol xhigh; round 3 READY, zero open findings;
64-test offline suite). The published-package qualification bar of §Design
remains open — the guide GAP row and sibling-scaffold workaround page stand
until it is met.)
**Revised:** 2026-08-15 (c — implementation review clarifies the authored
backend seam, codegen ownership, and the fail-closed resume boundary)
**Revised:** 2026-08-15 (b — Draft → Accepted: author direction in session,
Charlie Cheever 2026-08-15, commissioning implementation; OQ4 resolved — the
commissioned lane owns v1 implementation, dual-family review per author
direction)
**Revised:** 2026-08-15 (a — initial draft recording the author's
product-surface ruling from the 2026-08-15 sitting)
**Related:** LLP 0181 (zero-configuration Expo integration — the supervised
development mechanics an initialized app must reach), LLP 0196 (template and
recipe portfolio — the `snapback new` surface this deliberately does not
overload), LLP 0223 (zero-config connect DX), LLP 0041 (the thirteen-package
publication closure and publication posture; optional
`@expo/snapback-expo-custody` is deliberately not installed by `snapback init`),
`issues/20260808-guide-gap-compose-snapback-into-existing-app.md`, Diary 0063
G4, LLP 0295 (published-matrix improvement program — D0.1 names this RFC a
lifecycle design co-owner),
`issues/20260821-fixed-origin-external-client-dev-lifecycle.md` (D0.1/W1
execution ticket)

## Summary

**Author ruling (Charlie Cheever, 2026-08-15, in session):** the product
surface for composing Snapback into an existing React or Expo application is
a new top-level **`snapback init`** command — not a backend-only template
mode on `snapback new`, and not a standalone composer package.

The split of meaning is the point: `snapback new` creates a complete project;
`snapback init` adopts Snapback into what is already here. This matches the
`init` convention agents and developers already carry from `git init`,
`eas init`, and `npx expo install` — run it at the root of the thing that
exists, and it composes rather than scaffolds.

This RFC records the ruling and proposes the behavior contract. Until it is
implemented and the published-package path is qualified, the paved path
remains the sibling-scaffold workaround documented in
`guide/clients/react-expo.md`, and the capability index keeps its GAP row.

## Motivation

`snapback new` covers the blank-directory case. The measured gap
(Diary 0063 G4; the guide-gap ticket) is the developer or agent who already
has a `create-expo-app` root — the most common arrival state — and wants a
Snapback backend beside it. Today's truthful workaround is to install the
coherent package set, scaffold a **temporary sibling project**, copy its
conventional `snapback/` child across, narrow the Expo typecheck boundary by
hand, and generate. Every step is mechanical, which is exactly the signature
of a missing command.

The backend-only-template alternative was considered and rejected: it reuses
`snapback new`'s machinery but overloads "new" to sometimes mean "not new",
and it still leaves the client-seam wiring (provider, typecheck boundary,
supervised-dev reachability) as guide prose rather than executed behavior.
The composition problem is dominated by the *adoption* half — respecting
what already exists — which template emission does not address.

## Design

Behavior contract for `snapback init`, run at the root of an existing app.
Non-interactive first: every prompt has a flag or a refusal; an agent must be
able to run it with no TTY.

1. **Detect, or refuse loudly.** Recognize a `create-expo-app` root and the
   guide's React scaffold shape. Anything unrecognized refuses with a typed
   `SNAPBACK_INIT_*` diagnostic naming what was looked for, rather than
   guessing. The detection matrix widens by evidence, not speculation.
2. **Install one coherent closure.** Add the application-facing dependencies
   from the published thirteen-package closure (LLP 0041) at a single
   qualified version to the app's existing package manifest — using the app's
   own package manager, without rewriting unrelated dependencies, scripts, or
   configuration. The thirteenth package,
   `@expo/snapback-expo-custody`, is an optional native add-on and is
   deliberately **not** installed or configured by `snapback init`; an app
   opts into it explicitly, including its mandatory Expo config plugin.
3. **Adopt, never clobber.** Create only the conventional backend child and
   the required client integration seams. On first adoption, `init` seeds the
   packaged backend snapshot; afterward only `schema.mjs`, `functions.mjs`,
   and `seed.json` are byte-owned authored seams. `snapback/generated/` is
   codegen-owned: any generated contents are accepted and never resumed or
   rewritten by `init`. A pre-existing `snapback/` is resumable only when at
   least one authored seam is present and every present authored seam
   byte-matches what `init` writes; an empty, foreign, or mismatched child is
   a typed collision. A provider already wired in the app shell or a
   conflicting typecheck boundary likewise refuses with its targeted manual
   seam, never an overwrite. Re-running `init` on an already-initialized root
   is a no-op report, not an error and not a second copy.
4. **Narrow the typecheck boundary.** Apply the same tsconfig narrowing the
   guide currently instructs by hand.
5. **Exit into the ordinary lifecycle.** After `init`, `snapback generate`
   and supervised development (LLP 0181's carriers) work exactly as they do
   in a `snapback new` project; `init` introduces no parallel lifecycle.

**Qualification bar** (carried over from the ticket, unchanged): the path is
proven from clean existing React and Expo scaffolds — codegen, typecheck,
supervised development, and registered acceptance — against the **published**
packages. Only then does the guide's workaround page become the `init` page
and the capability GAP row flip.

## Open questions

- **OQ1 — detection scope at v1.** Proposal: exactly the two shapes above;
  bare Vite/Next/web-only roots refuse with a typed code that names the
  sibling-scaffold workaround. Widening is demand-driven.
- **OQ2 — template interplay.** Whether `init` can later borrow LLP 0196
  feature modules (`--with chat`-style) or stays minimal-adoption-only.
  Nothing in this ruling decides it.
- **OQ3 — acceptance registration.** Whether `init` also registers the
  default `snapback verify` proof command (LLP 0196's every-template rule)
  in the adopted app, or leaves that to `generate`.
- **OQ4 — implementation owner.** Resolved 2026-08-15: the author
  commissioned implementation in session (codex lane, dual-family review);
  this RFC is the design home.

## Dated amendment — 2026-08-21: D0.1 canonical lifecycle binding

LLP 0295 §D0.1 ruled one canonical development lifecycle (Adopted per
LLP 0295 default proposal; author may revise). The full ruling lives in
LLP 0223's 2026-08-21 dated amendment; this RFC is the co-owner for the
composition half, and the binding here is deliberately small:

- **Design point 5 sharpens.** "Exit into the ordinary lifecycle" now means
  the *ruled* lifecycle: an `init`-adopted app participates in exactly the
  same `snapback dev` verbs (fresh start / attach / regenerate / additive
  successor / shutdown), the same sessions-identity preservation, the same
  binding-admission postures — supervised rendezvous by default, the
  fixed-origin/external-client profile when the host app's own dev server
  (Vite, custom web stack) owns the client origin — and the same single
  ready receipt. `init` still introduces no parallel lifecycle and no
  lifecycle configuration files of its own.
- **The fixed profile is the adoption story for non-Expo hosts.** An
  existing app with its own dev server is precisely the external-client
  case: `init` composes the backend, and the fixed profile attaches the
  already-running client origin without handwritten binding environments.
  Detection-scope widening under OQ1 should therefore prefer widening into
  stacks the fixed profile can serve over inventing per-stack lifecycle
  glue.
- **Qualification bar unchanged**, and the D0.1 acceptance (one packed-
  package M1 → M2 additive change with accounts and sessions intact) applies
  to `init`-adopted fixtures the same as scaffolded ones. Execution ticket:
  `issues/20260821-fixed-origin-external-client-dev-lifecycle.md`.
