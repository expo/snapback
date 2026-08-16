# LLP 0258 Phase 3: completeness manifest, templates, fixtures, and guide journey

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Auth, Code generation, Client lifecycle, Templates, Guide,
React, React/Expo, Familiar profile
**Date:** 2026-08-15
**Governing:** LLP 0258 D9, Phase 0.4, and Phase 3; LLP 0238 D7;
LLP 0253 S6.1

## Already delivered — do not rebuild

- Phase 3.1's durable-versus-supervised precedence is in `b186296fd`: the
  opted-in Expo provider delegates to the app client and applies LLP 0258 D5
  at boot, remint, and `refreshAuthority`.
- Phase 3.2 is in the same landing: ordinary applications use the auth facade;
  `adoptAuthority` remains only on the legacy/advanced composition seam.
- Phase 3.3's Familiar hook aliases (`useAuth`, `useCurrentPrincipal`) are in
  `b186296fd`. The canonical React hooks and `client.auth` owner are already
  shipped by `b186296fd` and `450d150e6`.
- `d42dabce3` already generates `ApplicationAuthBootstrapV1`; this ticket does
  not create a second auth configuration or another manifest.

## Remaining D9 completeness rows

Extend the existing generated `client-lifecycle.v1.json` source table rather
than hand-maintaining a parallel artifact. It currently covers operation
reference lifecycles; its `custody` object describes the generated artifact's
regenerable-cache custody, not application auth. Add and gate all LLP 0258 D9
rows:

1. each bootstrap-policy field, its normalized `defineAuth`/schema derivation,
   semantic-identity effect, and Familiar disposition;
2. each entry mechanism's exact client method, React/Familiar hook, target
   capability, predecessor rule, and exact result type, including signup's
   one-time recovery projection;
3. recovery consumption and rotation rows derived from `recoveryPolicy`, with
   their predecessor rules, capabilities, facade methods, and exact recovery
   return contracts;
4. platform-to-custody adapter and honest grade, including browser/Expo-web,
   explicit volatile memory, and native refused/pending rows;
5. the complete bootstrap stages, public state arms, advisory/diagnostic
   classes, and typed remediations;
6. ordinary-versus-advanced owner exclusivity and duplicate-owner refusal;
7. supervised-adoption precedence, remint/refresh behavior, and conflict
   advisory; and
8. capability-index and guide anchors.

Make existing codegen, headless declarations, React/Expo declarations,
Familiar re-exports, and diagnostics prove they consume or are checked against
those rows. Do not replace the already-landed runtime implementations merely
to satisfy the table.

## Fixtures and templates

- Complete Phase 0.4 by freezing four clean application fixtures: browser
  Explicit, Expo Explicit, browser Familiar, and Expo Familiar. Package tests
  that construct descriptors in memory and the data-resource generated
  fixtures do not satisfy this clean-app boundary.
- Update `packages/snapback-cli/templates/react`: it still constructs
  `new SnapbackClient(...)` plus a low-level React provider. Move the ordinary
  auth-capable path to the generated app, `createSnapbackAppClient`, canonical
  provider mode, current-principal projection, and `useSnapbackAuth` password
  entry/sign-out without an application `AuthCoordinator` or bearer setter.
- Update `packages/snapback-cli/templates/expo-chat`: it already renders
  `SnapbackExpoProvider app={app}`, but does not exercise the opted-in auth
  fact, current-principal/auth hooks, anonymous-ready entry, or sign-out. Add
  the same ordinary journey without claiming native durable custody before
  the Phase 2 platform row passes.
- Prove Explicit and Familiar fixtures normalize to the same bootstrap policy
  and use the same runtime/client/custody owners; only their generated source
  and profile identities may differ.

## Intent guide closure

Add one runnable first-party application-auth journey to
`guide/auth/passwords.md`, then route browser React and Expo readers to it from
`guide/clients/react.md` and `guide/clients/react-expo.md`. Cover generated
policy/capability admission, anonymous `ready`, signup/sign-in,
`useSnapbackCurrentPrincipal`, reload or supported relaunch, sign-out, user
switch, recovery-return custody, and the native evidence limitation.

Retain `guide/recipes/browser-auth.md` as the advanced external-broker/custom
composition path and retain `guide/auth/targets.md` plus
`guide/auth/native-apps.md` as the threat-model and target-honesty pages. The
ordinary journey must link those seams rather than deleting or silently
generalizing them.

## Exit

The four clean fixtures and both template acceptances pass; the generated D9
table fails closed on an unclassified auth-program/mechanism/platform/profile
field; the guide capability GAP moves to the new journey; and both guide and
inventory checks are green.


## Addendum (2026-08-15, r4 delta review)

- The D9 recovery-lifecycle rows derive from LLP 0214 `recoveryPolicy`, but
  the current codegen `AuthProgramV1`/`AUTH_PROGRAM_FIELDS` omit
  `recoveryPolicy` entirely (`packages/snapback-codegen/define.mjs`). The
  Phase 3 D9 work must reconcile that source-field gap before generating
  recovery rows (found by the codex r4 delta review).

## Claim (2026-08-16)

The 531ce12aa orchestration session is executing this ticket's D9
completeness rows (including the addendum's recoveryPolicy source-field
reconciliation), the guide journey/routing closure, and both CLI template
updates, in two lanes dispatched now. The Phase 0.4 clean fixtures are NOT
claimed and remain open here. Per the fleet convention this claim yields
to landed code.
