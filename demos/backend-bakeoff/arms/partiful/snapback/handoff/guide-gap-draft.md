# Guide-gap drafts from Partiful / Snapback

These are coordinator-ready drafts only. This worker did not edit `guide/`,
`issues/`, LLPs, or shared reports.

## guide-gap: Register assets and notifications in the capability index

The generated capability manifest explicitly reports:

- `assetUpload: false` and capability gap `assets`;
- `notifications: false` and capability gap `notifications`.

`guide/capabilities.md` promises to list every author-facing capability,
including explicit GAP rows, but it has no assets or notifications rows. A
builder must search generated/demo artifacts or draft LLPs to learn that the
features are absent.

Desired outcome:

- add owned, dated GAP rows for authenticated assets and notification/effect
  delivery;
- link the draft asset and notification LLPs as authorities;
- give builders a discoverable “do not fake this with app rows” boundary.

Evidence:

- `work/snapback/generated/capability.manifest.json`
- `evidence/acceptance-results.json`, PARTY-08 and PARTY-13/14

## guide-gap: State the codegen-time action egress requirement

`guide/backend/actions-and-fetch.md` says the runtime needs
`SNAPBACK_OUTBOUND_ACTIONS=1`. Running codegen without that variable produced
`BUNDLE_UNSUPPORTED_FETCH` for a correctly declared Action. Source inspection
showed the codegen validator consumes the same gate.

Desired outcome:

- show the variable on generate/dev/build commands that compile fetch-using
  action bundles;
- make the diagnostic say that the gate applies at codegen and runtime;
- ideally let the ordinary app CLI carry the declared action capability into
  codegen without an ambient shell variable.

Evidence:

- `evidence/failed-attempts.md`
- capsule assistance event `codegen egress admission`

## guide-gap: Document or pave anonymous generated reads in sessions mode

A plain `SnapbackClient` public query was refused because it did not offer
auth-client protocol v1. Constructing a protocol-bearing client was then
refused because v1 requires browser, agent, or external-bearer custody. The arm
had to hand-wire the public query HTTP request with the protocol header and omit
the caller-selected auth body.

Desired outcome:

- provide a first-class anonymous/public client constructor for sessions apps,
  or document the supported generated-client path;
- include a public-preview-in-sessions example;
- ensure the diagnostic points to a valid anonymous construction, not a
  protocol option that custody rules reject.

Evidence:

- `work/tests/acceptance.mjs` (`anonymousQuery`)
- `evidence/failed-attempts.md`
