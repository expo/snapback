# Implementation notes

## Native path

The arm follows SpacetimeDB's ordinary model: private tables hold authoritative state; caller-dependent views expose allowed rows; reducers derive actor identity and authorize writes; generated bindings provide typed reducers and tables; WebSocket subscriptions deliver row changes. There is no product polling.

The seed contains 2 organizations, 3 primary teams, 4 primary projects, 20 labels, 500 issues, 1,000 comments, 1,000 issue-label joins, and 500 activity rows. Alice is owner, Bob is a member of all primary teams, and Mallory is an outsider.

## Deliberate glue

- `page_result` is an identity-scoped durable materialization for parameterized 50-row cursor pages because views cannot accept runtime parameters.
- Persona registration maps server-issued development identities to deterministic fixture roles.
- Optimistic issue changes are an application-owned pending projection; SpacetimeDB native optimism is not claimed.
- Expected-revision compare-and-set in the reducer defines deterministic conflict settlement.

## Capability boundaries

- Full-text search is `GAP`; no client filtering is presented as backend search.
- A disconnected SDK object retains warm in-memory rows, but a cold connection starts empty and a disconnected reducer call is not accepted as an offline queue. Persistent offline views and queued edits are `GAP`.
- Maincloud is `UNAVAILABLE_REMOTE_DEPENDENCY`; all deployment evidence is explicitly local.
- The CLI exposes no ordinary standalone database export command. V1/V2 sources, exact seed, schema, lockfiles, and migration log provide a deterministic rebuild path, not a claimed provider backup.

## Migration

V1 was seeded first. V2 added trailing `issue.customerImpact` with default `normal` and a B-tree index. Publishing with `--delete-data=never` retained all 500 seeded issues, defaulted all 500 rows, and accepted an authoritative post-migration update. The publish correctly warned that schema changes disconnect clients.

The TypeScript insert type still requires the defaulted field for new inserts, so new V2 rows specify `customerImpact: "normal"` explicitly.
