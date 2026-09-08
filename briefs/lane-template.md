# Lane C — the chat template as a product

Worktree: `~/projects/snapback-s2-c`, branch `s2/el-template`, base `3062777ab`.
Rulings: plan.md § C (C1–C8). LLP to revise: `llp/1002-dev-loop.spec.md` (section "templates are
products"; the template inventory table if it has one).

You own `snapback2/packages/snapback2/templates/chat/**` (backend `.q`, `delivery.ts`, `seed.ts`,
`tests/`), the `snapback2 dev` URL file (C7: `crates/snapback2` dev verb + the React template's
`vite.config.ts` + the Expo template's config), `init`'s printed next-step line, and the template
snippet `init` writes into the project's `AGENTS.md`. In `react/src`, `expo/src`, `shared/` make
ONLY the mechanical op renames of C6 — a sibling lane rewrites those screens next.

Order of work:

1. Reproduce: scaffold the chat template, run `check`, `test`, note the 30-check receipt and the
   op list in `.snapback/build/api.d.ts` (both `thread`s, `send` and `post`).
2. C1 — consolidate the modules exactly as the plan lists. Keep every rule, index, cap, retain,
   tombstone, schedule and channel in `schema.q` intact (the offline/delivery model of LLP 1012 is
   not yours to change). `send` fans `notify` out to every other member after `deliver`; a
   member's `principal != viewer` guard; the effect payload stays `{ to, body }`.
3. C2 — return rows from inserts; drop spelled nulls for optional columns.
4. C3 — rewrite `delivery.ts` as a plain effect. Also `notifications.q`'s `recordNotified` stays
   as the `then` target (that is the effects contract, LLP 1003).
5. C4 — fixtures on disk. Produce `photo.jpg` (a real baseline JPEG ≥ 8×8, a few hundred bytes)
   and `clip.mp4` (a real minimal MP4 with one video track; `ffmpeg` if present, else write the
   bytes the current test synthesizes to the file ONCE with a throwaway script you do not commit).
   The journeys read the files. If the journey runtime has no `fs`, add `fixture(name)` to
   `snapback2/test` (resolve relative to the test file) — the only SDK change permitted here.
6. C5 — remove every `@ref` comment from every file under `templates/` (all templates, not only
   chat); keep a gloss only as a plain comment when a builder needs it.
7. C6 — mechanical renames in screens/tests/shared so the template compiles and its journeys pass.
8. C7 — `dev` writes `.snapback/dev-url`; the Vite config and Expo config read it when the env var
   is unset; `init`'s next line and the `AGENTS.md` snippet say `npm install && npx snapback2 dev
   && npm run dev` (React) and the Expo equivalent. Add `.snapback/` to the template `.gitignore` if
   it is not already there. The owner spawns and watches nothing.
9. Verify: `check` green, `test` receipt shows the same or more passes (30 checks on base; effects
   blocked without the engine is expected), `node --test tests/chat-screens-owner.test.ts` and
   `tests/chat-screens-transition.test.ts` pass (they scaffold the template), `scripts/test.sh`
   green, `scripts/witness-web.mjs` still runs if it is part of test.sh.
10. Revise LLP 1002 and write `REPORT-template.md`: the final op inventory from `api.d.ts`, the
    line counts of every template file before and after, and the receipt before/after.

Out of scope: the screens' shape (lane A2), the Quarry grammar (lane B), `reset`/persona
collisions (ticketed elsewhere), any engine change.
