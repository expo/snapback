# RT3a adapter statements

Each invocation binds one text digest. The CTE returns at most one row from each primary key; the anchor returns metadata for an absent token. Duplicate digests remain a Rust resolver error. There is no LIMIT, SELECT *, expiry comparison, generation judgment or worker authorization in SQL.

## SQLite

Source: `snapback4/crates/snapback4-core/src/store/authority.rs`. SQLite binds `?1`; Postgres binds `$1` through its typed prepared statement.

Read storage absent:

```sql
WITH sessions AS (SELECT principal, COALESCE(family, token_digest) AS family, kind, token_digest, expires_at, 0 AS scope, NULL AS cap_expires_at, NULL AS principal_generation FROM _sessions WHERE token_digest = ?1)
SELECT s.principal, s.family, s.kind, s.token_digest, s.expires_at, s.scope,
       s.cap_expires_at, s.principal_generation, COALESCE(g.generation, 0),
       (SELECT value FROM _meta WHERE key = 'worker:session-family'),
       (SELECT value FROM _meta WHERE key = 'worker:session-revision'),
       (SELECT value FROM _meta WHERE key = 'worker:family:' || s.family),
       (SELECT value FROM _meta WHERE key = 'generation'),
       (SELECT value FROM _meta WHERE key = 'store_id'),
       NULL,
       (SELECT value FROM _meta WHERE key = 'schema_hash'),
       (SELECT value FROM _meta WHERE key = 'activation_hash'),
       (SELECT value FROM _meta WHERE key = 'device:generation')
FROM (SELECT 1) AS anchor LEFT JOIN sessions s ON true
LEFT JOIN _principal_generations g ON g.principal = s.principal
```

Read storage attached:

```sql
WITH sessions AS (SELECT principal, COALESCE(family, token_digest) AS family, kind, token_digest, expires_at, 0 AS scope, NULL AS cap_expires_at, NULL AS principal_generation FROM _sessions WHERE token_digest = ?1 UNION ALL SELECT principal, family, kind, token_digest, expires_at, 1, cap_expires_at, principal_generation FROM _read_sessions WHERE token_digest = ?1)
SELECT s.principal, s.family, s.kind, s.token_digest, s.expires_at, s.scope,
       s.cap_expires_at, s.principal_generation, COALESCE(g.generation, 0),
       (SELECT value FROM _meta WHERE key = 'worker:session-family'),
       (SELECT value FROM _meta WHERE key = 'worker:session-revision'),
       (SELECT value FROM _meta WHERE key = 'worker:family:' || s.family),
       (SELECT value FROM _meta WHERE key = 'generation'),
       (SELECT value FROM _meta WHERE key = 'store_id'),
       NULL,
       (SELECT value FROM _meta WHERE key = 'schema_hash'),
       (SELECT value FROM _meta WHERE key = 'activation_hash'),
       (SELECT value FROM _meta WHERE key = 'device:generation')
FROM (SELECT 1) AS anchor LEFT JOIN sessions s ON true
LEFT JOIN _principal_generations g ON g.principal = s.principal
```

## Postgres

Source: `snapback4/crates/snapback4-core/src/engine/postgres/authority.rs`. SQLite binds `?1`; Postgres binds `$1` through its typed prepared statement.

Read storage absent:

```sql
WITH sessions AS (SELECT principal, COALESCE(family, token_digest) AS family, kind, token_digest, expires_at, 0 AS scope, NULL::BIGINT AS cap_expires_at, NULL::BIGINT AS principal_generation FROM _sessions WHERE token_digest = $1)
SELECT s.principal, s.family, s.kind, s.token_digest, s.expires_at, s.scope,
       s.cap_expires_at, s.principal_generation, COALESCE(g.generation, 0),
       (SELECT value FROM _meta WHERE key = 'worker:session-family'),
       (SELECT value FROM _meta WHERE key = 'worker:session-revision'),
       (SELECT value FROM _meta WHERE key = 'worker:family:' || s.family),
       (SELECT value FROM _meta WHERE key = 'generation'),
       (SELECT value FROM _meta WHERE key = 'store_id'),
       (SELECT generation FROM _backend WHERE singleton),
       NULL::TEXT, NULL::TEXT, NULL::TEXT
FROM (SELECT 1) AS anchor LEFT JOIN sessions s ON true
LEFT JOIN _principal_generations g ON g.principal = s.principal
```

Read storage attached:

```sql
WITH sessions AS (SELECT principal, COALESCE(family, token_digest) AS family, kind, token_digest, expires_at, 0 AS scope, NULL::BIGINT AS cap_expires_at, NULL::BIGINT AS principal_generation FROM _sessions WHERE token_digest = $1 UNION ALL SELECT principal, family, kind, token_digest, expires_at, 1, cap_expires_at, principal_generation FROM _read_sessions WHERE token_digest = $1)
SELECT s.principal, s.family, s.kind, s.token_digest, s.expires_at, s.scope,
       s.cap_expires_at, s.principal_generation, COALESCE(g.generation, 0),
       (SELECT value FROM _meta WHERE key = 'worker:session-family'),
       (SELECT value FROM _meta WHERE key = 'worker:session-revision'),
       (SELECT value FROM _meta WHERE key = 'worker:family:' || s.family),
       (SELECT value FROM _meta WHERE key = 'generation'),
       (SELECT value FROM _meta WHERE key = 'store_id'),
       (SELECT generation FROM _backend WHERE singleton),
       NULL::TEXT, NULL::TEXT, NULL::TEXT
FROM (SELECT 1) AS anchor LEFT JOIN sessions s ON true
LEFT JOIN _principal_generations g ON g.principal = s.principal
```
