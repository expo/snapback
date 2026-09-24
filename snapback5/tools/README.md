# Counting concepts

From the repository root, with Node 24 on `PATH`:

```sh
node snapback5/tools/concept-count.mjs --arm snapback4
node snapback5/tools/concept-count.mjs --arm snapback5
```

Each command prints three sub-counts, their sum, every entry with a
representative source location (and the number of other locations), and
SHA-256 hashes of the inputs. It runs
`npx --no-install snapback4 check` using this checkout's CLI shim and debug
binary on a byte-for-byte copy of the committed `intent-clique.q`. It
writes that fixture and the generated `api.ts` only under
`snapback5/.work/concept-count/`. Neither a server nor a registry lookup is
needed. Both arms generate the same API and use the same runtime states.

Prepare a fresh checkout first (these are Snapback 4's build prerequisites,
not new Snapback 5 gates):

```sh
cd snapback4
bun install --frozen-lockfile
cargo build --workspace
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
cd ..
```

`extract-guide.mjs` recognizes forms in the language and keyword cards'
compiled `quarry` fences and inline reference spans, including the three
cards embedded in `guide.rs`.
It excludes the diagnostic registry, discovery machinery and starter
templates. The recognizers name grammar forms, modifiers, terms and
builtins; they normalize application names and numeric bounds, remove
string contents and comments, and record every matching source location.
Inline references include forms that examples leave implicit, such as the
default `retain until-revoked` policy and the `else:` control-flow arm.
The entry count is computed from the distinct matched forms, never a
hard-coded total. Optional server forms and older spellings that the cards
still document as compiling are included. Independently authored forms
and modifiers count separately; a compound form is not split into its
component words. New grammar forms need a recognizer as well as a guide
example. This is an extraction of the documented surface, not a proof
that the parser admits no other syntax.

For Snapback 5 the extractor reads only the inline backtick spans in all
six bullets of LLP 4000 §3.1. It folds whitespace and counts distinct spans;
code examples, bullet labels and unenumerated prose do not add entries.
`(old, next)` stays one span; `first` and `last N by` are separate spans.
This literal commissioned population does not expand the prose mentions
of types, control flow and builtins into a full language inventory. The
Snapback 4 guide is more explicit; the raw difference is not evidence of
an equivalent reduction in concepts or implementation effort.

The runtime extractor counts each `Read`/`Write` union alternative from
`contract.ts`, including fresh and replayed `sent` separately; auth states
come from `AuthState` in `app.ts`. Today's generated API imports rather
than repeats these definitions. It also counts `E_GENERATION` explicitly
and every distinct refusal the generated file enumerates, including
`Require codes` comments and any `E_*` spelling. Other diagnostic codes
and arbitrary capitalized identifiers are excluded. New variants whose
discriminants cannot be distinguished cause an error instead of silently
deduplicating states.

The `check` bucket follows the commission's frozen populations: 14 authored
equivalents for Snapback 4, seven derived concepts for Snapback 5. The
larger reading splits the depth step from its trigger, eviction from
retention, and `server` from `device`. A concept can occur once in each
bucket: the rule adds the three charges, rather than deduplicating across
authoring and output. It never multiplies a concept by table or operation
count. These are populations, not a count of lines printed for one fixture.

The [commission report](../reports/20260924-concept-count.md) and
[LLP 4000 §7.1](../../llp/4000-snapback5.rfc.md#71-the-count-at-commission)
record the ambiguities, source-layout deviation and measurement limits.
Focused extractor checks run with:

```sh
node --test snapback5/tools/concept-count.test.mjs
```
