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

Read `AGENTS.md` before adding features. With the dev server running, the
served guide and capability index live at
`http://127.0.0.1:4287/_snapback/guide/index.md` (or run
`snapback guide <query>`).
