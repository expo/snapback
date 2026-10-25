# Find a guide by task

Find the recipe for your next task. These commands name registered cards.

```sh
snapback4 guide staging --full
```

Use these commands as written; `--full` prints the complete recipe.
`guide CARD --sections` lists headings and exact selectors.

| Task | Command |
| --- | --- |
| Start a backend or translate from SQL/Convex | `snapback4 guide from-sql --full` |
| Real password accounts, several roles, staging and probe:serve | `snapback4 guide staging --full` |
| Decide which roles may read or change each field | `snapback4 guide security --full` |
| Understand a hidden lookup or a refused write | `snapback4 guide testing --section "Refusal ladder"` |
| Upload once as its placing user, then share its original row | `snapback4 guide assets --full` |
| Sign-in, readiness, browser without a device, or React hooks | `snapback4 guide client --full` |
| Rendered UI proofs, date/file inputs and host cleanup | `snapback4 guide testing --full` |
| Deadlines, server time and staging clock advances | `snapback4 guide time --full` |
| Pages, continuations and complete/partial answers | `snapback4 guide reads --full` |
| Deploy, rollback and saved releases | `snapback4 guide deploy --full` |
| Raw HTTP without the SDK | `snapback4 guide wire --full` |
| Quarry branches, null guards and typed list accumulators | `snapback4 guide programs --full` |
| What's changed in this package | `snapback4 guide changes --full` |

For an error code, use `snapback4 why CODE`. Unknown card names print nearby
registered names; `snapback4 guide aliases` lists supported alternate names.
