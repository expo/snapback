# Where does the expected value come from? The recurring test defect in this program

Status: open
Date: 2026-08-24
Systems: testing discipline
Related: LLP 0303, issues/20260824-entitlement-predicates-for-the-live-sites.md,
  issues/20260822-claims-versus-enforcement-is-endemic.md

## The pattern

One fix has now failed review three times, each time for a *different* insufficiency in the same
test. Every strengthening was correct and none of them proved the property:

| Round | The test asserted | Why it still proved nothing |
|---|---|---|
| 1 | the call was refused | said nothing about *which* rows were affected |
| 2 | exact accepted/refused sets and exact error codes | observed **method return values**, not the database — a mutation binding the row to a different principal stayed green because the returned struct still reported the derived user |
| 3 | exact **durable rows**, untouched rows byte-compared | the expected hash was **copied from the observed stored value**, so the assertion reduced to `stored == stored`; substituting SHA-256 of a fixed known code left everything green |

The third is the most instructive, because by then the test was doing everything previously
demanded: reading durable state, asserting exact sets, comparing untouched rows. It was still
vacuous, because of where its *expected* value came from.

## The rule this yields

> **For every assertion, ask where the expected value comes from.** If it comes from the same read
> as the actual value, or from the production code path under test, the assertion proves nothing.
> Expected values must be computed independently — from a returned artifact, a fixture constant, or
> a value the test itself chose.

This is the same defect class the whole program is about, relocated into the tests: something
*correlated* with the property is checked instead of the property. A test that derives its
expectation from the system under test is exactly a fence whose guarantee rests on the thing it is
supposed to be guarding.

## Required practice for the remaining rows

Every fix landing under LLP 0303 must, in addition to the existing bar (watched fail-first quoted
verbatim; exact accepted/refused sets; durable rows read back; mutation review including
comparison-operator mutations and subjects on both sides of lexical ordering):

**Report an assertion-provenance audit** — assertion by assertion, naming the source of each
expected value, and including the assertions concluded to be sound with the reason. A reviewer
should not have to discover a tautology by reading the fixture.

## Why this is filed rather than remembered

There are 68 rows to fix under this ruling and each will be tested by a different lane. The bar
that took three rounds to discover here should cost the next lane zero rounds. Reviewers should
also treat "the test asserts durable state" as insufficient on its own — it was insufficient here.
