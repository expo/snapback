Current warm SQL sequence, base `e26d1ebc95`. Captured from the real account ingress and borrowed query-snapshot APIs; timed by SQL replay. The committed RT0 Postgres ratchet agrees on account W1=6 and W2=6. Historical RT0 was 23/23/153 before RT3/RT4; it is not today’s baseline.

| Shape | SQL work per request, in order | Statements |
|---|---|---:|
| W1 | authority; START read-only repeatable-read; final authority; message byId; membership by room/principal; ROLLBACK | 6 |
| W2 | authority; START read-only repeatable-read; final authority; membership; newest-20 room scan; ROLLBACK | 6 |
| W3 | authority; START read-only repeatable-read; final authority; 32 membership scan; SAVEPOINT + one 32-room prefetch + RELEASE; 64 room size preflights interleaved with 64 room fetches; ROLLBACK | 136 |

W3 evaluates `.room.total` twice per accepted membership. The prefetch does not remove the later metered size/fetch calls on this source base. Composition collects each of the 32 distinct room images once; a future engine route must still preserve both logical reads and their meters. No product change is made here.

Unique prepared SQL templates follow; parameters remain placeholders. Repeated calls share the same prepared template, as in the adapter cache.

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
	       NULL::TEXT, NULL::TEXT, NULL::TEXT,
	       (SELECT seq FROM _head WHERE singleton)
	FROM (SELECT 1) AS anchor LEFT JOIN sessions s ON true
	LEFT JOIN _principal_generations g ON g.principal = s.principal;
```

```sql
START TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;
```

```sql
SELECT r.data, i.k FROM i JOIN r ON r.t = i.t AND r.id = i.id WHERE i.t = $1 AND i.ix = $2 AND i.k >= $3 AND i.k < $4 ORDER BY i.k ASC LIMIT $5;
```

```sql
ROLLBACK;
```

```sql
SELECT r.data, i.k FROM i JOIN r ON r.t = i.t AND r.id = i.id WHERE i.t = $1 AND i.ix = $2 AND i.k >= $3 AND i.k < $4 ORDER BY i.k DESC LIMIT $5;
```

```sql
SAVEPOINT prefetch;
```

```sql
WITH hits AS MATERIALIZED (SELECT q.ord, hit.data FROM unnest($3::bytea[], $4::bytea[]) WITH ORDINALITY AS q(lo,hi,ord) LEFT JOIN LATERAL (SELECT r.data FROM i JOIN r ON r.t = i.t AND r.id = i.id WHERE i.t = $1 AND i.ix = $2 AND i.k >= q.lo AND i.k < q.hi ORDER BY i.k LIMIT 1) hit ON true) SELECT ord, data FROM hits WHERE (SELECT COALESCE(SUM(octet_length(data)),0) FROM hits) <= $5::bigint ORDER BY ord;
```

```sql
RELEASE SAVEPOINT prefetch;
```

```sql
SELECT octet_length(r.data)::bigint, octet_length(i.k)::bigint FROM i JOIN r ON r.t = i.t AND r.id = i.id WHERE i.t = $1 AND i.ix = $2 AND i.k >= $3 AND i.k < $4 ORDER BY i.k ASC LIMIT $5;
```
