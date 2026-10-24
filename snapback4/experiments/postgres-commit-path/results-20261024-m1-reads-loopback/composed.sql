-- M1 experiment only, not a product lowerer or authorization policy.
-- $1: account session digest; $2: message id (W1) / room id (W2).
-- W3 has only $1. The 19 authority facts retain their native column types.
SET search_path=sb4_eval_m1,pg_catalog;

-- W1_generic_composed
WITH authority(principal,family,kind,token_digest,expires_at,scope,cap_expires_at,principal_generation,current_principal_generation,worker_family,worker_revision,family_revision,store_generation,store_id,backend_generation,schema_hash,activation_hash,device_generation,head) AS MATERIALIZED (WITH sessions AS (SELECT principal, COALESCE(family, token_digest) AS family, kind, token_digest, expires_at, 0 AS scope, NULL::BIGINT AS cap_expires_at, NULL::BIGINT AS principal_generation FROM _sessions WHERE token_digest = $1 UNION ALL SELECT principal, family, kind, token_digest, expires_at, 1, cap_expires_at, principal_generation FROM _read_sessions WHERE token_digest = $1)
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
	LEFT JOIN _principal_generations g ON g.principal = s.principal), msg AS MATERIALIZED (SELECT data,NULL::bytea AS k FROM r WHERE t='messages' AND id=$2), mem AS MATERIALIZED (SELECT r.data,i.k FROM authority a CROSS JOIN i JOIN r ON r.t=i.t AND r.id=i.id WHERE i.t='memberships' AND i.ix='$intent:byRoomPrincipal:97c7db2245b2c441' AND i.k>=((decode('06','hex')||convert_to((SELECT data::jsonb #>> '{Row,room,Id}' FROM msg),'UTF8')||decode('0000','hex'))||(decode('06','hex')||convert_to(a.principal,'UTF8')||decode('0000','hex'))) AND i.k<((decode('06','hex')||convert_to((SELECT data::jsonb #>> '{Row,room,Id}' FROM msg),'UTF8')||decode('0000','hex'))||(decode('06','hex')||convert_to(a.principal,'UTF8')||decode('0000','hex'))||decode('ff','hex')) ORDER BY i.k LIMIT 1) SELECT a.*, ARRAY(SELECT data FROM msg) AS messages, ARRAY(SELECT data FROM mem) AS memberships, ARRAY[]::text[] AS rooms FROM authority a;

-- W1_typed_composed
WITH authority(principal,family,kind,token_digest,expires_at,scope,cap_expires_at,principal_generation,current_principal_generation,worker_family,worker_revision,family_revision,store_generation,store_id,backend_generation,schema_hash,activation_hash,device_generation,head) AS MATERIALIZED (WITH sessions AS (SELECT principal, COALESCE(family, token_digest) AS family, kind, token_digest, expires_at, 0 AS scope, NULL::BIGINT AS cap_expires_at, NULL::BIGINT AS principal_generation FROM _sessions WHERE token_digest = $1 UNION ALL SELECT principal, family, kind, token_digest, expires_at, 1, cap_expires_at, principal_generation FROM _read_sessions WHERE token_digest = $1)
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
	LEFT JOIN _principal_generations g ON g.principal = s.principal), msg AS MATERIALIZED (SELECT * FROM typed_messages WHERE id=$2), mem AS MATERIALIZED (SELECT m.* FROM authority a JOIN typed_memberships m ON m.principal=a.principal WHERE m.room=(SELECT room FROM msg)) SELECT a.*, ARRAY(SELECT m::typed_messages FROM msg m) AS messages, ARRAY(SELECT m::typed_memberships FROM mem m) AS memberships, ARRAY[]::typed_rooms[] AS rooms FROM authority a;

-- W2_generic_composed
WITH authority(principal,family,kind,token_digest,expires_at,scope,cap_expires_at,principal_generation,current_principal_generation,worker_family,worker_revision,family_revision,store_generation,store_id,backend_generation,schema_hash,activation_hash,device_generation,head) AS MATERIALIZED (WITH sessions AS (SELECT principal, COALESCE(family, token_digest) AS family, kind, token_digest, expires_at, 0 AS scope, NULL::BIGINT AS cap_expires_at, NULL::BIGINT AS principal_generation FROM _sessions WHERE token_digest = $1 UNION ALL SELECT principal, family, kind, token_digest, expires_at, 1, cap_expires_at, principal_generation FROM _read_sessions WHERE token_digest = $1)
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
	LEFT JOIN _principal_generations g ON g.principal = s.principal), msg AS MATERIALIZED (SELECT r.data,i.k FROM i JOIN r ON r.t=i.t AND r.id=i.id WHERE i.t='messages' AND i.ix='$intent:byRoomAt:cac276d27b82ccf0' AND i.k>=(decode('06','hex')||convert_to($2::text,'UTF8')||decode('0000','hex')) AND i.k<((decode('06','hex')||convert_to($2::text,'UTF8')||decode('0000','hex'))||decode('ff','hex')) ORDER BY i.k DESC LIMIT 20), mem AS MATERIALIZED (SELECT r.data,i.k FROM authority a CROSS JOIN i JOIN r ON r.t=i.t AND r.id=i.id WHERE i.t='memberships' AND i.ix='$intent:byRoomPrincipal:97c7db2245b2c441' AND i.k>=((decode('06','hex')||convert_to($2::text,'UTF8')||decode('0000','hex'))||(decode('06','hex')||convert_to(a.principal,'UTF8')||decode('0000','hex'))) AND i.k<((decode('06','hex')||convert_to($2::text,'UTF8')||decode('0000','hex'))||(decode('06','hex')||convert_to(a.principal,'UTF8')||decode('0000','hex'))||decode('ff','hex')) ORDER BY i.k LIMIT 1) SELECT a.*, ARRAY(SELECT data FROM msg) AS messages, ARRAY(SELECT data FROM mem) AS memberships, ARRAY[]::text[] AS rooms FROM authority a;

-- W2_typed_composed
WITH authority(principal,family,kind,token_digest,expires_at,scope,cap_expires_at,principal_generation,current_principal_generation,worker_family,worker_revision,family_revision,store_generation,store_id,backend_generation,schema_hash,activation_hash,device_generation,head) AS MATERIALIZED (WITH sessions AS (SELECT principal, COALESCE(family, token_digest) AS family, kind, token_digest, expires_at, 0 AS scope, NULL::BIGINT AS cap_expires_at, NULL::BIGINT AS principal_generation FROM _sessions WHERE token_digest = $1 UNION ALL SELECT principal, family, kind, token_digest, expires_at, 1, cap_expires_at, principal_generation FROM _read_sessions WHERE token_digest = $1)
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
	LEFT JOIN _principal_generations g ON g.principal = s.principal), msg AS MATERIALIZED (SELECT * FROM typed_messages WHERE room=$2 ORDER BY at DESC,id DESC LIMIT 20), mem AS MATERIALIZED (SELECT m.* FROM authority a JOIN typed_memberships m ON m.principal=a.principal WHERE m.room=$2::text) SELECT a.*, ARRAY(SELECT m::typed_messages FROM msg m) AS messages, ARRAY(SELECT m::typed_memberships FROM mem m) AS memberships, ARRAY[]::typed_rooms[] AS rooms FROM authority a;

-- W3_generic_composed
WITH authority(principal,family,kind,token_digest,expires_at,scope,cap_expires_at,principal_generation,current_principal_generation,worker_family,worker_revision,family_revision,store_generation,store_id,backend_generation,schema_hash,activation_hash,device_generation,head) AS MATERIALIZED (WITH sessions AS (SELECT principal, COALESCE(family, token_digest) AS family, kind, token_digest, expires_at, 0 AS scope, NULL::BIGINT AS cap_expires_at, NULL::BIGINT AS principal_generation FROM _sessions WHERE token_digest = $1 UNION ALL SELECT principal, family, kind, token_digest, expires_at, 1, cap_expires_at, principal_generation FROM _read_sessions WHERE token_digest = $1)
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
	LEFT JOIN _principal_generations g ON g.principal = s.principal), mem AS MATERIALIZED (SELECT r.data,i.k FROM authority a CROSS JOIN i JOIN r ON r.t=i.t AND r.id=i.id WHERE i.t='memberships' AND i.ix='$intent:byPrincipalRoom:4cdf929dd56b24d2' AND i.k>=(decode('06','hex')||convert_to(a.principal,'UTF8')||decode('0000','hex')) AND i.k<((decode('06','hex')||convert_to(a.principal,'UTF8')||decode('0000','hex'))||decode('ff','hex')) ORDER BY i.k LIMIT 32), rooms AS MATERIALIZED (SELECT r.id,r.data FROM mem m LEFT JOIN r ON r.t='rooms' AND r.id=(m.data::jsonb #>> '{Row,room,Id}') WHERE (m.data::jsonb #>> '{Row,room,Id}')!='r1024' ORDER BY m.k LIMIT 32) SELECT a.*, ARRAY[]::text[] AS messages, ARRAY(SELECT data FROM mem) AS memberships, ARRAY(SELECT data FROM rooms) AS rooms FROM authority a;

-- W3_typed_composed
WITH authority(principal,family,kind,token_digest,expires_at,scope,cap_expires_at,principal_generation,current_principal_generation,worker_family,worker_revision,family_revision,store_generation,store_id,backend_generation,schema_hash,activation_hash,device_generation,head) AS MATERIALIZED (WITH sessions AS (SELECT principal, COALESCE(family, token_digest) AS family, kind, token_digest, expires_at, 0 AS scope, NULL::BIGINT AS cap_expires_at, NULL::BIGINT AS principal_generation FROM _sessions WHERE token_digest = $1 UNION ALL SELECT principal, family, kind, token_digest, expires_at, 1, cap_expires_at, principal_generation FROM _read_sessions WHERE token_digest = $1)
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
	LEFT JOIN _principal_generations g ON g.principal = s.principal), mem AS MATERIALIZED (SELECT m.* FROM authority a JOIN typed_memberships m ON m.principal=a.principal ORDER BY m.room,m.id LIMIT 32), rooms AS MATERIALIZED (SELECT r.id,r.total FROM mem m LEFT JOIN typed_rooms r ON r.id=m.room WHERE m.room!='r1024' ORDER BY m.room,m.id LIMIT 32) SELECT a.*, ARRAY[]::typed_messages[] AS messages, ARRAY(SELECT m::typed_memberships FROM mem m) AS memberships, ARRAY(SELECT r::typed_rooms FROM rooms r) AS rooms FROM authority a;
