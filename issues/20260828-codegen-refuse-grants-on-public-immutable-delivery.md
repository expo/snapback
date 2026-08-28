# Refuse `grants: true` on a `public-immutable` upload intent (LLP 0317 O54)

**Status:** Open
**Opened:** 2026-08-28
**Owner:** unassigned (LLP 0317 O54; asset pipeline)
**Systems:** Codegen, Assets, Diagnostics
**Related:** LLP 0317 O54 and §Scale-tail questions answered, LLP 0044,
LLP 0239, `guide/recipes/view-once-media.md`,
`issues/closed/20260828-scale-tail-two-open-questions.md`

## The contradiction

`defineAssetUpload` admits `grants: true` alongside
`delivery: { kind: 'public-immutable' }`. Those two declarations cannot both
mean anything: a grant edge is authority over a **governed** byte request, and
public-immutable delivery has no governed read to gate, so the declared grant
can never deny a byte. `ctx.assets.revoke` on such an asset is a no-op against
the URL an app actually hands out.

Both facts are authored in the same declaration and are visible together at
generate time. Nothing couples them today: the delivery profile is validated
against the target's advertised profiles
(`packages/snapback-codegen/index.mjs:7590`) and `grants` is validated
independently.

**Probe (2026-08-28).** Adding `grants: true` and `access: { read: 'owner-only' }`
to `demos/file-drop/snapback`'s existing `delivery: { kind: 'public-immutable' }`
upload intent and running
`node packages/snapback-codegen/index.mjs demos/file-drop/snapback` generates
clean — `codegen ok`, with no error and no warning about the combination. The
control run on the unmodified fixture emits the same single unrelated warning,
so the contradiction adds no diagnostic at all. This is the reproduction; turn
it into the negative test.

## Why generate-time and not documentation

`guide/recipes/view-once-media.md:313,335` already prescribes `grants: true`,
an `owner-only` read policy, and `private-strict` delivery, and already states
that revocation "controls future governed requests, not bytes the client
already copied". The `sol-snapback-explicit` lane read that guidance
(`run-log.md:131`) and shipped public-immutable anyway, so more prose is not
the intervention. Per LLP 0317.000 P2, the cheapest rung that would have caught
a *declared* contradiction is generate-time refusal.

The coupling has a precedent one subsystem over, in the other direction:
`SNAPBACK_MEDIA_COLLECTION_SHARING_GRANTS_UNDECLARED` refuses a recipient
sharing plan whose upload intent omits `grants: true`
(`packages/snapback-codegen/index.mjs:12224`).

## Work

1. **Refuse** `grants: true` on an intent whose resolved `delivery.kind` is
   `public-immutable`, with the exact repair in the message: `private-strict`
   for next-request denial, `private-signed` when a TTL-bounded bearer URL is
   acceptable — plus the honest note that neither retracts bytes already
   delivered.
2. **Second half:** a revoke/close call (`ctx.assets.revoke`, the generated
   close/revoke operations) against an intent declared `public-immutable`
   should be a typed refusal rather than a silent no-op.
3. Route the new code per LLP 0193 (guide anchor on
   `guide/recipes/view-once-media.md`), add a retrieval-eval seed, and
   regenerate the diagnostics registry chain with
   `node scripts/check-inventories.mjs`.
4. Profile-neutral: the refusal must fire identically in Explicit and Familiar
   source (LLP 0317.000 P3).

## Explicitly not in scope

Refusing an **application-level** view-once feature that declares no
revocation at all — a `expiresAt` field, a `markViewed` mutation, UI hiding
over a public-immutable asset. LLP 0317 r4 declined that: the only available
signal is authored vocabulary, such a rule cannot be stated precisely, it fires
on legitimate designs (an expiring *text* message needs no asset revocation),
and it turns a naming choice into a generate-time failure. That residue is
recorded as out of reach of both codegen and the guide rather than papered
over.
