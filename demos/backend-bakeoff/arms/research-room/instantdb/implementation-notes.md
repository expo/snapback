# Implementation notes

## Native path

- `instant.schema.ts` models rooms, profiles, sources, questions, durable
  progress, answers, and effect-attempt settlement records with typed entities,
  unique/indexed keys, and links.
- `instant.perms.ts` derives room membership and ownership through `data.ref`.
  The progress-create rule also reads the linked question status. A late
  user-scoped progress write after confirmed cancellation was rejected by the
  provider, leaving zero authoritative late rows.
- Seed objects use 20 real 64 KiB Storage objects and 20 deterministic
  32-dimensional embeddings.
- Keyword retrieval uses the ordinary indexed InstaQL `$ilike` path.
- Bob's second user-scoped backend client observes live query updates over the
  provider's EventSource-backed `subscribeQuery` implementation.
- Stable ids and unique indexed dedupe keys make repeated question/answer
  transactions idempotent.

## Explicit nonclaims

- Embeddings are retained as JSON, but no provider-native vector similarity
  query/index path was found. No custom cosine calculation is presented as a
  native semantic capability.
- No first-party scheduled-function path was found. A local timer would not
  satisfy the protocol, so none is used.
- Consequently, the scheduled external fetch could not demonstrate a
  provider-hosted function/secret boundary. Exact credential/canary scanning
  still passed.
- The anonymous temporary app was emptied completely and every actor token was
  invalidated. Its admin token could not list/delete the shell through the CLI
  account path, so the empty shell awaits Instant's documented temporary-app
  auto-expiry and cleanup is an explicit GAP.

## Evidence-handling amendment

CLI output that could contain credentials remained in ignored mode-0600 files
and was removed. No raw process arguments, browser storage, CLI configuration,
or credential-bearing command lines were retained. Environment evidence
allowlists only ports and listener counts.
