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

## RT3a fix round 1 discovery

The facts SELECTs above are unchanged. Only when availability is false and the
first SELECT returns no session, query the catalog in the same transaction:

```sql
-- SQLite
SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = '_read_sessions');
-- Postgres: the adapter pins its namespace and pg_catalog in search_path.
SELECT pg_catalog.to_regclass('_read_sessions') IS NOT NULL;
```

If present, rerun the facts SELECT with the read-session arm. A raw digest
containing NUL returns no session before SQL. Full-session hits still take one
facts statement. Fixture backups initialize availability from the copied catalog.

The lead approved the resulting SQLite RT0 `unknown_token` cost of 4 instead of
3 for a store with no read-session storage. The extra statement is exactly the
SQLite catalog SELECT above. It runs only after a false availability flag and a
no-read-arm session miss. Full-session hits return before it; known read-session
hits use the read arm directly. First discovery of a read session on a stale
handle starts as a miss, then reruns the facts SELECT. A store that has ever
minted a committed read session already knows storage exists and never pays the
probe, including on unknown-token requests. All other RT0 cells are unchanged.
