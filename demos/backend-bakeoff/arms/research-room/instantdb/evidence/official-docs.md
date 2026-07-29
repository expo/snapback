# Official InstantDB references used

- [CLI](https://www.instantdb.com/docs/cli) — temporary app initialization and configuration push.
- [Backend](https://www.instantdb.com/docs/backend) — admin initialization, scoped users, queries, transactions, and subscriptions.
- [Modeling data](https://www.instantdb.com/docs/modeling-data) — typed entities and links.
- [Writing data](https://www.instantdb.com/docs/instaml) — atomic transactions, links, and lookups.
- [Reading data](https://www.instantdb.com/docs/instaql) — InstaQL filters and ordering.
- [Permissions](https://www.instantdb.com/docs/permissions) — `data`, `newData`, `data.ref`, and action rules.
- [Common mistakes](https://www.instantdb.com/docs/common-mistakes) — `data.ref` returns a list and `newData.ref` does not exist.
- [Auth](https://www.instantdb.com/docs/auth) and [Managing users](https://www.instantdb.com/docs/users) — user/token lifecycle and `$users` links.
- [Storage](https://www.instantdb.com/docs/storage) — upload, `$files`, linking, and file permissions.
- [Streams](https://www.instantdb.com/docs/streams) — evaluated separately from durable live-query progress.
- [Webhooks](https://www.instantdb.com/docs/webhooks) and [Platform API](https://www.instantdb.com/docs/platform-api) — checked for ordinary hosted automation surfaces.

All implementation decisions were independently derived from these official
surfaces. No implementation code from another bakeoff arm was copied.
