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
| 4 | the expected hash **computed independently** as SHA-256 of the returned code | the fixture stores exactly **one** hash of **one deterministic** preimage, so a constant equal to *that* code still survives — `SHA-256(returned) == stored` holds and `after == expected` holds because only one row is ever issued |

The third is the most instructive, because by then the test was doing everything previously
demanded: reading durable state, asserting exact sets, comparing untouched rows. It was still
vacuous, because of where its *expected* value came from.

## Round 4: one sample cannot distinguish a function from a constant

Round 4 is the subtlest and generalises furthest. The assertion was finally sound in *form* — the
expected value was computed independently of the stored row. It was still vacuous, because the
fixture could only ever produce **one** value.

The production code hashed the issued code; the test asserted the stored hash equalled SHA-256 of
the returned code. But `CounterRandom` makes generation deterministic, and only one issuance ever
succeeds, so replacing the hash function with a hardcoded constant equal to that single expected
value satisfies the assertion exactly. In production every issued row would then share one
selector — and the exchange query selects `WHERE code_hash = ?1` with **no UNIQUE constraint**, so
same-client users collapse onto a shared authorization code.

The kill, from the review: **issue twice under two authorities, and assert the two durable values
each equal SHA-256 of their own returned code AND differ from each other.** One constant cannot
satisfy two preimages.

Stated generally:

> **A single sample cannot distinguish a function from a constant.** Where an assertion checks that
> a stored value was *derived* from an input, the test must exercise at least two distinct inputs
> and assert the outputs differ. Otherwise "derived correctly" and "hardcoded to this one case" are
> observationally identical.

This applies well beyond hashes: any derived identifier, fingerprint, digest, correlation token, or
computed key.

## Round 5: vary every axis the code derives from — and check for fixture collapse

Round 4's rule was still too narrow. It said "exercise two distinct inputs" for a derived *value*.
A later review found the same defect on a different axis, in a fix that had met every previously
stated bar item on its first attempt.

The production code derived **both** the user and the session from the authority. The test varied
the *selected request* across lower/caller/upper — but every authority in the test was the same
`user-m` / `session-m` pair. So this mutation, which discards the derivation entirely, stayed green:

```rust
let _ = Self::require_agent_grant_management_session(authority, "grant approval")?;
let user_id = "user-m";
```

Every test authority *was* `user-m`, so all accepted/refused outcomes and every durable row were
identical. In production, any valid management session could have approved that user's request.

**Fixture collapse** is the second half of the same problem. The same fixture made the agent owner
equal to the caller, so a mutation writing the agent owner as `effective_user_id` was also
indistinguishable — grants would misbind in production wherever owner and grantor differ.

Stated generally:

> **Vary every axis the production code derives from, and make every role in the fixture distinct.**
> If the code derives N facts from an input, a test holding that input constant proves none of them.
> If two roles in a fixture happen to be equal, a mutation swapping them is invisible.

Practical requirement: before writing assertions, list the role pairs in the fixture — owner vs
caller, grantor vs owner, subject vs session-owner — and state for each whether they are distinct.
Any pair left equal is an axis the tests cannot see.

## Round 6: a readback cannot see a column it does not project

Round 5 required varying every derived axis. A further review found a mutation surviving even that,
because the *projection* was narrower than the write.

Production wrote all eleven `_auth_grants` columns; the test's readback projected five. So this
mutation stayed green:

```rust
let expires_at_ms = now_ms;
```

Every grant becomes immediately expired. It changes the durable value and the returned value
**consistently**, and the test asserted only returned identity — so nothing could observe it. The
authorization-clock write to `_snapback_meta` was likewise unprojected.

> **A readback that omits a column the production path writes cannot see mutations to that column.**
> Before asserting, enumerate every column the code under test writes and show each appears in the
> projection. Where a column is deliberately excluded, say why and what else covers it.

For inherently variable columns — timestamps, generated ids, digests — assert the *relationship*
that makes them meaningful rather than mere presence: `expires_at_ms == created_at_ms + TTL`,
`revoked_at_ms IS NULL`, or a digest computed independently in the test. "The column is populated"
is not an assertion about correctness.

## Round 7: "intentionally equal by contract" must name the mutation it hides

Round 5 introduced the fixture role audit — list every role pair, mark each distinct or
intentionally equal. A lane produced one, a reviewer accepted it, and a second reviewer then broke
it, because the audit's escape clause was doing no work.

The audit declared *authority user vs session owner* "intentionally equal by the session contract".
A second reviewer **compiled and ran** the mutation rather than reasoning about it, and found that
deriving `session_id` from `user_id` — instead of from the authority's own session — stayed green.
The equality the audit had waved through was exactly what hid it.

> **"Intentionally equal by contract" is only acceptable if you can name the mutation that equality
> would hide, and show it is caught elsewhere.** Otherwise the pair must be made distinct, or a case
> added where they differ.

### And: run the mutations, do not reason about them

The two reviews of the same commit differed in method and in outcome. One reasoned about the
mutations and accepted the audit; the other pointed `vendor/ibex` at an existing checkout so the
crate would compile, applied each mutation, ran the tests, restored the tree, and reported which
mutants actually died. It confirmed three and found a fourth that reasoning had missed.

Where a lane or reviewer can compile, **executed mutation results outrank argued ones**. An argued
mutation review is a hypothesis; a run one is evidence.

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
