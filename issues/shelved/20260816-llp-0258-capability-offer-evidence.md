# LLP 0258 capability offers lack admitted target evidence

**Opened:** 2026-08-16
**Status:** Open
**Systems:** Auth, Codegen, Vite, Expo, Qualification
**Related:** LLP 0258 Phase 4; `grev-codex.final.md` finding 2;
`grev-grok.final.md` finding 3

## Problem

Application-auth binding admission checks offered capabilities, but the
development supervisors currently derive `offered` by copying the generated
descriptor's `capabilities.required`. That is application self-attestation,
not evidence from the selected runtime target. The React template previously
performed this copy directly (`packages/snapback-cli/templates/react/src/main.tsx:9`
in the reviewed tree); the Expo supervisor performs the equivalent projection
in `packages/snapback-cli/expo-dev.mjs` (reviewed near lines 1195–1207).

The gap begins earlier in generation. Target capability validation runs before
the application-auth requirements are appended to the descriptor (reviewed
`packages/snapback-codegen/index.mjs:6469` versus 7017), and `auth.passwords`
is not a `TargetCapabilityId` checked against the selected target catalog.
Consequently, requiring `auth.application-bootstrap.v1` and `auth.passwords`
at binding admission is fail-closed against the binding record, but cannot yet
prove that the runtime behind that record implements those capabilities.

## Phase-4 closure wanted

As part of LLP 0258 Phase-4 qualification, define an admitted target/supervisor
evidence carrier for capability offers, bind it to target and descriptor
identity, and derive `AppBindingV1.capabilities.offered` only from that carrier.
Bring `auth.passwords` and `auth.application-bootstrap.v1` into target
capability validation (or define their governed successor vocabulary), with
negative qualification witnesses for an older target catalog and for a
required capability absent from the evidence. Replace both the Vite and Expo
required-to-offered projections only once that evidence path exists.
