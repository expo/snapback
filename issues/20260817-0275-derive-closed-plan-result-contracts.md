# LLP 0275: derive exact result contracts from closed declarative plans

Status: Open

Authority: Draft LLP 0275 D3; Accepted LLP 0108 and LLP 0245 remain the current
contract owners until LLP 0275 is accepted.

## Problem

Declarative mutation plans already carry enough information to determine some
results exactly, but authors must repeat that fact in `result:`. The Bugboard
starter-derived app needed both:

```js
plan: insert('bugs', values, { bindIdAs: 'bugId' }),
returns: returnBinding('bugId'),
result: results.value(v.id('bugs')),
```

and its status mutation paired `returnChangedCount()` with an explicit integer
contract. This is synchronized transcription, not an application decision.

## Scope

- Define closed proof rules for the initial LLP 0275 D3 return forms.
- Generate one effective result contract with provenance `authored`,
  `plan-derived`, or `unknown`.
- Feed the effective contract through existing manifest identity, runtime
  validation, generated API typing, React typing, and review projections.
- Permit a compatible explicit contract and fail generation on an incompatible
  one.
- Remove duplicate result declarations from first-party templates where the
  new derivation is exact.

Do not infer authorization, visibility, effects, or opaque JavaScript return
shapes. Do not widen a partially derived expression to `v.json()` or
`unknown` while labeling it exact.

## Acceptance

- `returnBinding` of an ID minted by typed `insert`, `returnChangedCount`, and
  `returnDocument` produce exact generated result types without `result:`.
- Exact `returnLiteral` and admitted `returnExpr` cases have positive and
  ambiguity/refusal fixtures.
- Authored/derived mismatch fails before artifacts activate.
- Runtime result validation and atomic failure semantics are identical to an
  equivalent authored contract.
- Packed React and CRUD templates typecheck and prove after their redundant
  result declarations are removed.
- Generated artifacts expose result-contract provenance and freshness checks
  cover it.

## W3 progress (2026-08-22)

VCF-E-P1–P4 are implemented and packed: `returnBinding` of an inserted ID,
`returnChangedCount`, and `returnDocument` derive exact effective contracts;
closed-plan table dependencies and result provenance are projected; compatible
authored controls produce identical result/dependency and authority evidence;
and conflicting authored transcriptions refuse before active output. The React
template no longer repeats the now-derivable result contract.

This ticket remains open because D3's wider acceptance still calls for exact
`returnLiteral` and provable `returnExpr` rules, the remaining first-party
template migrations, and their ambiguity fixtures. W3 does not relabel those
underivable cases as exact.
