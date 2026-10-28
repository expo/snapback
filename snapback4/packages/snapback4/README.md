# Snapback 4

Write a schema, rules and operations in Quarry; check generates typed client
handles. Use online React/Expo clients, or declare sync for offline tables.

Install Snapback first so documentation is readable while the frontend installs:

```sh
npm i snapback4
npx snapback4 guide start
npx snapback4 init . --web --online --password
```

Read **guide start** once, then write the schema. It contains a complete
customer/staff workflow with private fields, upload evidence, deadlines and
approval. It replaces a README + cheatsheet + introductory card tour.
Do not read the full language/security cards or declaration files before coding.
Init prints a file map and starts frontend dependency installation in the
background. `node scripts/install.mjs --status` shows progress;
`node scripts/install.mjs --wait` waits once when you are ready to build.
Use `npm run probe:check` to verify a preview. probe:serve stays up until SIGTERM;
use `npm run probe:serve -- --hold` only when you intend to keep it serving.

Exact signatures on demand: `npx snapback4 guide api client`, `guide api auth`,
`guide api proof`, `guide api generated`. Repeated project reads show only new
content; `--repeat` forces that read and `--full` lists bounded reference sections.

Further reading when the task needs it:

- `guide production`: one complete real-user provisioning/preview/production recipe.
- `guide uploads`: placement, same-image copies and authorized download handles.
- [Client and operations reference](./CLIENT-AND-OPERATIONS.md#your-first-working-account-screen): the optional
  account/avatar/thread walkthrough, client lifecycle, offline and operational detail.
- [Server reference](./SERVER.md): deployment and release lifecycle.
- [Offline uploads](./OFFLINE-UPLOADS.md), [Following adoption](./FOLLOWING-ADOPTION.md).
- [Changelog](./CHANGELOG.md); `guide changes` for version-specific changes.

Requires Node 24.x. React and Playwright are optional peers; install them only
when using their respective client/proof surfaces.
