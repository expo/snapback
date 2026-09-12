# Working on Snapback 3

Read [LLP 2000](../llp/2000-snapback3.rfc.md), then [README.md](README.md).
This is an independent product experiment, alongside Snapback 2 and Fable's
Snapback 4. Work in this directory in the main checkout: Charlie explicitly
requested side-by-side directories on 2026-09-12. Scope commits to your own
files; other agents may be changing the surrounding checkout.

Use Rolldown/Oxc for JavaScript builds and TypeScript for type checking.
Do not introduce esbuild without a concrete reason and an author-visible
explanation. Run Cargo and Bun here, not at the repository root. This Rust
workspace has no Ibex/Hermes bootstrap dependency.

Inherited code comes from Snapback 2 at
`a93edb979a5cbe6357f1fc1f95b66f85bd308844`. Existing 1000-series references
explain that inherited behavior; they do not import the whole Snapback 2
process. Preserve useful provenance and add 2000-series references for new
decisions. Do not import sibling implementation packages at runtime.

Keep authoring, execution, delivery, client state, and product behavior in
agreement. A compiler accepting syntax is not evidence that its runtime is
supported. Refuse unsupported capabilities at project admission, with a
concrete diagnostic. Keep experimental omissions visible in the README.

Run affected tests. Changes to durable writes must exercise lost replies and
reopening the database. Client changes must exercise account changes,
incomplete evidence, persistence failure, and reconnect. Keep checks bounded
and reuse the inherited corpus. Do not add a second proof bureaucracy.

Keep source files under 1,500 lines. Record important decisions in LLP 2000;
record actual build experience and measurements in the accompanying diary.
