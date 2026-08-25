# No other feature-selectable trust roots — and a correction to how I reported the first one

Status: open
Date: 2026-08-25
Systems: snapback-kernel, snapback-auth
Related: llp/0303-subject-authority-correlation-policy.decision.md,
  issues/20260825-additive-feature-writer-sweep-98-of-100-already-rowed.md

## The correction first

A review of the hosted-edge lane found, and executed, a compile-time trust-root substitution:
`test-support` builds swap the production Ed25519 verification root for a deterministic development
identity whose signing seed `[7; 32]` is committed to an integration fixture. I reported that as
though it were a live defect in the shipped system.

**It is not.** A second reviewer swept for the same shape and reported it could not find the swap at
`origin/main` at all, adding the right caveat rather than assuming the first reviewer was wrong:

> If the programme's prior execution of `build-identity` is still the ground truth, this checkout is
> not the tree it ran against.

Checked directly, and both reviewers were correct. `origin/main` carries no such substitution. The
lane's **own proposed commit introduced it** while implementing the runtime-owned fixed root — the
diff adds `#[cfg(not(any(test, feature = "test-support")))]` and its complementary arm.

So this is a defect **in an unlanded fix, caught by review before landing**, not an exposure in the
running system. That distinction matters for anyone reading the earlier characterisation, and the
error was mine: I dispatched a repository-wide sweep for a shape whose only instance lived in a lane
worktree, then described the result as if it applied to production.

It also happens to be the system working exactly as intended — the fix for a
caller-supplied-trust-root defect introduced a build-selectable trust root, which is
LLP 0303 revision (p) in its purest form, and the gate caught it.

## The sweep result

With that established, the sweep's actual finding is a useful negative: **no further instances.**

The definition used to draw the line, which is worth keeping:

> Does the ordinary serving path, in a non-`cfg(test)` compilation that a dependent can produce,
> verify or mint against a different root, secret, or entropy source than production, **without
> anyone calling a test helper?**

Extra `#[doc(hidden)]` constructors, fail-points that default off, and `pub` test fields all fail
that line — they are capability-by-composition, not a swapped compiled-in root, and belong to the
`test-support` surface inventory rather than here.

Read rather than inferred: both `hosted_edge` files, `compose_hosted_edge_admission`, `BuildIdentity`,
every workspace `Cargo.toml` feature table, every `cfg(not(any(test, feature = "test-support")))` arm
under `crates/`, all `from_seed_unchecked` call sites, `ProofKeyring::from_fixed_seed`, the Ask
loopback, outbound policy, `build_distribution`, ibex feature enablement, and the
`pack-hosted-release` pin.

Explicitly not done: re-running `build-identity`, and exhaustively reviewing the hundreds of
`#[cfg(any(test, feature = "test-support"))]` **add-only** helpers beyond confirming from surrounding
code that they are add-only.

## Why the negative result is worth having

Two sweeps have now run over the feature-gated hazard class. The writer sweep found 98 of 100 items
already rowed; this one found no further trust-root substitutions. Both were dispatched because a
single-lane finding looked like it might describe a systemic hole, and in both cases the systemic
version turned out to be contained.

That is worth stating plainly, because the reflex after a sharp finding is to assume the class is
everywhere. Here it was not — twice.
