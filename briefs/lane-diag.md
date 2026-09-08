# Lane D — diagnostics say the fix; `why` speaks

Worktree: `~/projects/snapback-s2v`, branch `s2/el-diag`, base `3062777ab`.
Rulings: plan.md § D (D1–D6). LLP to revise: `llp/1002-dev-loop.spec.md` (diagnostics and `why`
sections).

You own diagnostic construction in `snapback2/packages/compiler/src/quarry/**` (messages,
rewrites, candidate lists; not the grammar — lane B changes grammar in parallel, so do not add,
remove, or rename constructs), `snapback2/packages/snapback2/guide/families.source.json` and the
compiler test that checks it, the `check` printer (Rust, `crates/snapback2`), the `why` verb
(`crates/snapback2`, plus whatever the compiler must emit so sites map to `file:line`), and the
guide page that documents `why`.

Order of work:

1. Reproduce on the base: scaffold the chat template, append to `feeds.q` (a) `query allPosts():
   return posts[]`, (b) `query anyProfile(p: principal): return memberships[p]`, (c) misspell
   `authorId` as `authorid` in a mutation; capture the three `check` JSON lines. Run `why
   deliveries.thread '{"conversationId":"conversation-1"}' --as charlie` and `--as alice` with
   `dev` running; capture both.
2. D1 — the missing-bound diagnostic: detect "table read used as a value, no range clause, no
   exactly-matching unique index" before the unknown-index path; message and rewrite as the plan
   words them; the candidate list names every `by` index whose column prefix the supplied keys
   match, then the unique indexes that match exactly; key types print as declared. Compiler test
   cases for `posts[]`, `memberships[p]`, and a genuinely unknown key set (which still reports
   unknown, with the real types).
3. D2 — did-you-mean for every unknown-name site (table, column, index, fn, proc, shape, op,
   enum case, module): one shared helper (Damerau-Levenshtein ≤ 2 or case-only), the rewrite
   reads "did you mean `X`?" with the nearest name; when nothing is near, the rewrite lists the
   declared names as today. Tests for a column, an index, and an enum case.
4. D3 — `families.source.json`: rewrite every TypeScript-surface example to Quarry (or the CLI/TS
   harness where the family is about seeds, effects, journeys); delete entries whose code no
   longer has an emitting site, and delete that dead site if any remains; add the compiler test
   asserting no example contains `db.`, `rule.`, `ctx.`, `t.text(`, `withIndex`, `.take(`, and
   that every family's page resolves in `guide/`. Fix `E_OWNER_PROJECT_ROOT` (no `schema.ts`) and
   `E_INPUT` (no code inside the message); grep `crates/` and `packages/` for other messages that
   embed their own code or the deleted TS surface (`schema.ts`, `rule.`, `db.scan`) and fix them.
5. D4 — `check` prints full `message`/`rewrite` lines; find the 120-char cut (search the Rust
   printer for the truncation) and replace it with wrapping. A Rust test with a 200-char rewrite.
6. D5 — `why` prose by default, `--json` for the document. Map sites to `file:line`: the compiler
   knows each site's source position (diagnostics already print `snapback/messages.q:25:43`); if
   the certificate/IR does not carry it today, add the site table to the build output the owner
   already loads (no new file kind if an existing JSON can carry it). Print exactly the shape in
   the plan for denied reads; for admitted reads print per site: rows examined/visible, the bound
   and its state, the rule, then subscriptions. Rust tests on a scaffolded project for both cases
   (compare full output). Keep `why` under a second on the chat template.
7. D6 — the guide paragraph for `why` (find the page that documents `why` today; if none does,
   add it to `operator.md` or `testing.md` within budget; a new page only if neither fits).
8. `scripts/test.sh` green; `REPORT-diag.md` with all before/after outputs verbatim.

Out of scope: grammar changes (lane B), the client (lane A1), templates (lane C). If lane B's
deletion of `match`/`#`/the `by` shorthand would leave a family example stale, write the example in
the surviving form the plan's § B rulings name.
