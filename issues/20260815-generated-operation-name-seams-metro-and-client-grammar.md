# Generated operation names break at two seams: Metro export parsing and canonical-client grammar

**Filed:** 2026-08-15 · **Source:** clique-0121 exploratory sweep (LA Durand,
`~/clique-0121-20260814`), lanes `sol-snapback-familiar` and
`sol-snapback-simplified` (0.1.21) · **Systems:** Codegen, Client, Expo/Metro

## Problem

Two related defects around generated operation/export naming, both hit
independently in two lanes:

1. **Metro cannot parse generated export aliases.** Generated modules use
   arbitrary-string/quoted (dotted) ESM export aliases — valid modern ESM,
   but Metro 0.83 / Babel in the Expo 57 tuple rejects them. The familiar
   lane could not import generated `app.mjs` and fell back to importing the
   manifest through generated `api.mjs`; the simplified lane needed a
   hand-written `src/generated.ts` shim to hydrate the generated descriptor
   and data binding. Expo is a first-party arm; the canonical Expo bundler
   must be able to consume every generated module as emitted.

2. **Codegen accepts names the client refuses.** Dotted familiar operation
   exports were accepted by codegen but rejected by the canonical client
   unless they used CRUD leaf names. Whatever the supported operation-name
   grammar is, codegen, the generated client references, and the canonical
   client runtime must enforce the same one — a name that generates must be
   callable.

## Evidence

- `lanes/sol-snapback-familiar/diary.md` M1 ("dotted Familiar operation
  exports were accepted by codegen but rejected by the canonical client
  unless they used CRUD leaf names"; "generated `app.mjs` used quoted
  exports that Metro could not transform").
- `lanes/sol-snapback-simplified/diary.md` M1 and `final-report.md`
  fallbacks ("Metro 0.83 cannot parse the generated arbitrary-string/dotted
  ESM export aliases").

## Suggested fix

Emit only Metro/Babel-transformable export forms (plain identifiers, or a
namespace object) for every module the client tuple imports; add the shipped
Expo tuple's bundler to codegen CI as a parse gate. Unify the operation-name
grammar between codegen validation and client admission, with a shared
conformance test enumerating accepted/refused spellings.
