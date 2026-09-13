# `compile_fail,E####` error codes are not checked by rustdoc

Status: Open — affects every compile-fail doctest used as a structural proof
Created: 2026-08-22
Related: issues/shelved/20260822-claims-versus-enforcement-is-endemic.md,
issues/shelved/20260822-landed-fence-tests-do-not-prove-non-substitutability.md

## The finding

Rustdoc does **not** verify the error code in a `compile_fail,E####` doctest. It checks only that
the snippet fails to compile. Confirmed empirically by a reviewer: a doctest tagged
`compile_fail,E0624` whose body is `let _x: u32 = "hello";` (which produces **E0308**) still
**passes**.

## Why this matters here

The fence program uses compile-fail doctests as proof that a boundary is structural — that some
construction is *inexpressible* rather than merely unused. When such a test passes for the wrong
reason it is not weak evidence, it is **false** evidence, and it reads as proof.

This is not hypothetical. It already happened twice:

1. A `StreamRunnerHost::new` doctest called a two-argument function with one argument, so it
   failed on **arity** (E0061) rather than privacy (E0624). Making the constructor `pub` would
   have left it green — the exact hole it claimed to guard.
2. A doctest pinned `E0624` for a private method on a type where **the method does not exist at
   all**, so rustc emitted E0599. It was proving "this method is absent," not "host settlement is
   private." It was deleted rather than repaired.

Pinning the code was the remedy adopted for (1). This finding says the remedy is **weaker than
believed**: the pin documents intent, but nothing enforces it. A future edit that changes *why*
a snippet fails will not be caught.

That is the program's own defect class, one level down, in the tooling: a control that looks like
enforcement but runs on convention.

## What is actually true today

The six pinned fixtures in the stream-attempt work were verified by compiling the real snippets
as an **external crate** against the real types — not isomorphic toys — and each emits exactly
its declared code (four E0451, one E0624, one E0599). So the codes are correct *now*. Nothing
keeps them correct.

Known live consequence: adding a **private** `fn new` to `DurableStreamAttempt` turns its
`compile_fail,E0599` into E0624, and the doctest stays green. Adding a **public** `new` — the
hole the test exists to guard — does correctly go red. So the test still guards its stated hole,
but it is not sensitive to how it fails.

## Options

1. A checker that extracts `compile_fail,E####` doctests, compiles each as an external crate, and
   asserts the emitted code matches the pin. This is the only option that makes the pin
   enforcement rather than a comment. Cost: a build step per fixture; they are small.
2. Prefer `ui`-style tests (trybuild or equivalent) for boundary proofs, which do compare full
   stderr including codes, and reserve doctests for documentation.
3. Accept the limitation and record it in `guide/conventions.md`, so nobody again treats a pinned
   code as a machine-checked guarantee.

Option 1 is worth its cost only if compile-fail proofs stay load-bearing — which they currently
are, since module privacy means in-crate unit tests structurally cannot prove an external
construction boundary.

## Not claimed

That any pinned code is presently wrong. All six were checked by hand at the time of writing.
