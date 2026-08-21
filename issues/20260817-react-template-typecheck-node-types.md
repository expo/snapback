# React template typecheck lacks Node and ESNext library types

Status: Open

Related: LLP 0275 D6; Diary 0091

The public `@expo/snapback-cli@0.1.24` React scaffold installs successfully and
builds with Vite, but its documented `bun run typecheck` fails before any app
edits. Vite 8 declarations require Node types and `Symbol.asyncDispose`, while
the generated project omits `@types/node` and keeps the TypeScript library at
the default implied by `target: ES2022`.

Reproduction:

```sh
npx --yes @expo/snapback-cli@0.1.24 new typecheck-repro --template react
cd typecheck-repro
bun install
bun run typecheck
```

Representative failures are `TS2688: Cannot find type definition file for
'node'`, missing `node:http`, and `TS2550: Property 'asyncDispose' does not
exist on type 'SymbolConstructor'`.

The demo-local repair in `demos/bug-tracker` is to add `@types/node`, set
`compilerOptions.types` to `["node"]`, and set `lib` to
`["ESNext", "DOM", "DOM.Iterable"]`. The packaged React template should carry
the equivalent fix so a clean scaffold passes its own advertised typecheck.
