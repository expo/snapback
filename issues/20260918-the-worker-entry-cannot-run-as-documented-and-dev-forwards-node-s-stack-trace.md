# The documented worker entry sits one directory above the ESM island `init` builds for it

**Filed** 2026-09-18 · **Area** snapback4 / dev worker / guide · **Status** open
· **Score category** `setup_and_docs`

`setup_and_docs` is the programme's largest cumulative decline — 96 → 88 across
ten runs, fitted, inside an overall slope of −0.30/run. This is one concrete,
Snapback-attributable cause, named by the 0.2.28 builder and reproduced in their
own logs.

## What the builder said, and why they were wrong about it

`essay.md:27`: "the conventional worker entry and Node module mode produced
avoidable setup loops." `diary.md:18`: "The strict wire ID format and Node
module entry convention caused **agent mistakes, not demonstrated backend
defects**."

They took the blame. The evidence does not support that.

## What happened

`evidence/backend.log:175-195` — seven occurrences in one log:

```
snapback4 worker: .../snapback/server.ts (pid 25939)
(node:25939) Warning: Failed to load the ES module: .../snapback/server.ts.
  Make sure to set "type": "module" in the nearest package.json file or use the .mjs extension.
.../snapback/server.ts:1
import {appendFileSync,existsSync,readFileSync} from 'node:fs';
^^^^^^
SyntaxError: Cannot use import statement outside a module
    ... 7 frames of Node internals ...
snapback4 worker: exited exit status: 1; restarting in 250 ms
```

## The actual mechanism

`init` is deliberate and, in intent, right. It **preserves** the project's
module type rather than forcing ESM on the application
(`verbs/init.rs:54-62`, `inherited_package_type`), and instead creates a
scoped ESM island for the code it generates — `project.rs:280`:

```rust
pub const GENERATED_PACKAGE: &str = "{\"type\":\"module\"}\n";
```

written to `snapback/generated/package.json` (`init.rs:73`), with the reasoning
recorded at `@ref LLP 3000.007#20.2` — "scope generated ESM to its artifacts,
preserving existing application scripts' module interpretation." The 0.2.28
lane has that file; its contents are exactly `{"type":"module"}`.

**The island is `snapback/generated/`. The documented author entry is
`snapback/server.ts` — one directory above it.** So the generated code is ESM
and the author's entry beside it inherits the project's type. In this lane the
root `package.json` says `"type": "commonjs"` (line 48), and Node defaults to
CommonJS anyway when no `type` is declared.

Meanwhile the guide's example for that exact file is ESM —
`guide/actions.rs:35` and `guide/routes.rs:36`:

```ts
import { server } from "./generated/server.ts";
```

and `actions.rs:130`: "`snapback4 dev` starts `snapback/server.ts` (or `.mts`
or `.mjs`)".

So the documented entry, written the documented way, does not load in a
CommonJS project — while the generated code one directory down loads fine.
`"type": "module"` appears nowhere in `crates/snapback4-lang/src/guide/`,
`packages/snapback4/README.md` or `SERVER.md`; the precondition is never
stated.

## And Snapback declines to diagnose it

`crates/snapback4/src/dev_worker.rs:112`:

```rust
Ok(Some(status)) => eprintln!("snapback4 worker: exited {status}; restarting in {} ms", self.backoff.as_millis()),
```

The child's raw stderr is forwarded and the worker is restarted. Snapback has a
coded, sited diagnostic vocabulary with rewrites and `guide` pages behind it,
and uses none of it at the moment the builder is least oriented.

## Smallest change

Ranked. (1) alone would have saved this builder the loop.

1. **Make the documented entry `snapback/server.mts`.** The guide already says
   `.mts` works. An `.mts` entry is ESM regardless of the project's type, so the
   documented example loads everywhere and the island's boundary stops
   mattering. This is a card and example change, not an engine change.
2. **Refuse before spawning, with a rewrite.** If the entry is `.ts`/`.js`, its
   nearest `package.json` does not declare `"type": "module"`, and the file
   contains a top-level `import`, say so in Snapback's own idiom:

   > `snapback/server.ts` uses ES modules but the nearest `package.json` does
   > not declare them
   > rewrite: rename it to `snapback/server.mts` — or add `"type": "module"` to
   > `package.json`

3. **Recognise the failure if it still happens.** When the child exits non-zero
   with `Cannot use import statement outside a module` or `Failed to load the ES
   module` in its stderr, print that repair instead of only
   `exited {status}; restarting in {} ms`.
4. **State it in the card.** `guide actions` shows the entry; it should say what
   makes that entry loadable.

## The builder arrived at recommendation 1 themselves, after paying for it

The strongest evidence that (1) is the right fix is that the builder ended up
there unaided. Their final entry is:

```
$ ls lanes/astra-snapback4/snapback/ | grep server
server.mts
```

and the root `package.json` still says `"type": "commonjs"` — unchanged. They
did not add the field; they renamed the file. Seven failures, a restart loop,
and an eight-frame Node trace bought them the one-word answer that the guide
could have shipped as its example.

## Snapback already does this well elsewhere — 40 lines later in the same log

Once the worker loaded, the very next failure was:

```
snapback4 worker: Error: E_AUTH: this is a worker's door: send a live service
token (`snapback4 token --service <name>`)
```

Coded, specific, and it names the exact command that fixes it. That is the house
standard, and it is what makes the module-resolution failure conspicuous: the
capability to diagnose well is present and simply is not reached for at startup.
The gap is not skill or convention, it is coverage.

## On the restart loop

`dev_worker.rs` restarts a worker that failed at import time, on a backoff. For
a crash that is right; for a module-resolution error it cannot help — the same
failure recurs verbatim until a file is edited. Worth deciding whether a child
that has never once started successfully should keep being restarted. Snapback's
standing principle is loud refusal over silent degradation; a loop that reprints
an eight-frame Node trace is loud without being a refusal.

## Attribution, stated plainly

Not the harness's fault: a project with **no** `type` field fails identically,
because CommonJS is Node's default. Not the builder's fault either: they wrote
the documented file the documented way. The defect is that the ESM island `init`
builds does not extend to the one file `init` and the guide both tell the author
to write.

Related: [[20260918-n-no-horizon-advice-names-an-alphabetically-chosen-index]] —
same class. Detection and capability are strong; what a builder is told to *do*
is where the score leaks.
