# Snapback todo-contract starter

A backend-plus-headless starter: a generated Snapback todo backend exercised
through the headless client and acceptance suite. Despite the name it ships
no Contract UI surface — it is the smallest backend-first scaffold, and the
default for `snapback new`.

```sh
bun install
bun run dev     # supervised backend dev loop
bun run prove   # the acceptance command (writes .snapback/verify-receipt.json)
```

<!-- script-glossary:begin -->
## Script glossary

`bun run prove`: ordinary completion and the only done-oracle—the authoritative
aggregate `snapback verify` receipt (acceptance evidence, not formal proof).
`npm test`: raw acceptance implementation that `prove` wraps (debugging).
`bun run test:static`: no-server source/generated coherence.
`bun run carry:headless`: observation artifacts after accepting the `prove` receipt,
never proof authority. `bun run carry:self-check` checks carrier wiring only.
Migration: `test:live` was removed; use `npm test` for the same raw acceptance command.
<!-- script-glossary:end -->

Read `AGENTS.md` before adding features. With the dev server running, the
served guide and capability index live at
`http://127.0.0.1:4287/_snapback/guide/index.md` (or run
`snapback guide <query>`).
