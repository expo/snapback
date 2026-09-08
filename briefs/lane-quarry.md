# Lane B — one spelling each

Worktree: `~/projects/snapback-s2-quarry`, branch `s2/el-quarry`, base `3062777ab`.
Rulings: plan.md § B (B1–B6). LLP to revise: `llp/1011-quarry-ergonomics.rfc.md` (section "one
spelling", dated 2026-09-08; also amend `llp/1010-quarry-language-amendments.rfc.md` where it
specified `match` or `#`).

You own the Quarry front end (`snapback2/packages/compiler/src/quarry/**`), the lowering to IR
where B2 changes what a maintain point read yields, the evaluator and engine parity for that
read (`packages/evaluator`, `crates/snapback2-core` — the twin and the engine must agree; add a
corpus case), `api.d.ts` generation for maintain reads, the guide pages `grammar.md` and
`quarry.md` with `guide.rs`'s pinned definitions, every `.q` file in the repository, the compiler
fixtures and tests, and LLP 1011.

Order of work:

1. Inventory first: list every significant word the lexer/binder recognizes (declaration,
   table-body, rule, statement, range, builtin, type, modifier words, virtual tables, refused
   keywords with rewrites). Put the list in the report; it becomes the B5 pin.
2. B3 — index names explicit at declaration; refuse the shorthand with the rewrite spelling the
   inferred name. Update every `.q` (`by ownerId` → `by byOwnerId: ownerId`, etc.), fixtures,
   guide snippets, corpus programs.
3. B2 — maintain point reads yield the typed value (typed zero when absent); delete `#` from the
   lexer/parser/binder/lowering/printer for maintains and `connected`; `connected[p]` yields the
   count. Engine + evaluator parity: a corpus case reading an absent and a present maintain in a
   query and in a mutation (the mutation case reads after a write in the same program). `api.d.ts`
   types the read as the value. Update every `.q` (12 `#` sites) and the guide sentences (quarry.md
   lines about `#total[key]`, grammar.md's `connected` bullet).
4. B1 — delete `match`; make `if` narrowing cover the three cases the plan lists (else branch of
   `= null`, right operand of `and`, the block after `require x != null else CODE`); refuse a bare
   `!` with the rewrite `! else CODE`. Compiler tests for each narrowing case and for the refusals;
   rewrite the two `match` fixtures (`quarry-clique/social.q`, `quarry-surface/surface.q`) with
   `if`. Remove `match` from `grammar.md`, `quarry.md`, `families.source.json`, and `guide.rs`'s
   pin table; the construct count pin becomes the new list.
5. B4 — `walk` gets its grammar bullet, its pinned definition, and one quarry.md sentence.
6. B5 — the word-inventory test (one sorted literal in the compiler tests, asserted equal to the
   set the lexer/binder recognizes at runtime — derive the runtime set from the code, not from a
   second list); the grammar construct-count test updated (23: `match` out, `walk` in).
7. Byte budgets: `node build.mjs` must pass; deletions should free bytes on quarry.md — do not
   raise a budget. Check every `guide.rs` pinned definition survives.
8. `scripts/test.sh` green; corpus regenerated (fix the `spike.rs` count); `REPORT-quarry.md`
   with the inventory, the count of `.q` sites changed per ruling, and each refusal's exact
   before/after text.

Coordination: lane D (diagnostics wording, `families.source.json` examples, did-you-mean) runs in
parallel and does not touch grammar. When you update a family example that mentions `#`/`match`/
the shorthand, keep the edit minimal so the merge is mechanical. Lane C consolidates the chat
template's modules in parallel: apply your `.q` rewrites to the template files as they are on
your base; the orchestrator re-applies them on the consolidated files at integration.
