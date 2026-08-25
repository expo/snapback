# React template typecheck lacks Node and ESNext library types

Status: closed

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

## Resolution (2026-08-25)

The React template omitted Node declarations and ESNext/browser libraries
required by Vite 8 and its own configuration. Applying those settings exposed
one more template-local omission: `src/main.tsx` uses `import.meta.env`, but no
source declaration referenced `vite/client`. The CRUD dashboard is the only
other packaged Vite template and carried the same compiler gap.

Both Vite templates now include `@types/node` `^25.0.0`,
`types: ["node"]`, `lib: ["ESNext", "DOM", "DOM.Iterable"]`, and a
`vite/client` reference in their existing `src/snapback-dev.d.ts`. Packaged
qualification asserts all four inputs for both scaffolds. Fail-first was
confirmed against a fresh React scaffold: the new focused assertion reported
`@types/node` as `undefined`; after the first three repairs, the actual
typecheck failed with `TS2339` for `ImportMeta.env`, which guarded the final
ambient reference repair.

Fresh isolated React and CRUD scaffolds each completed `bun install` and
`bun run typecheck` with exit 0 (`tsc --noEmit`). The full package test was
also attempted, but an inherited todo-template receiver assertion at
`package.test.mjs:673` aborted the file before these downstream checks; the
focused two-scaffold reproduction passed instead.
