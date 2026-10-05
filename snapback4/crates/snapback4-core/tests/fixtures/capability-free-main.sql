BEGIN TRANSACTION;
CREATE TABLE _action_steps (
        invocation TEXT NOT NULL, name TEXT NOT NULL, input_digest TEXT NOT NULL,
        provider_key TEXT NOT NULL, state TEXT NOT NULL, claim_digest TEXT NOT NULL,
        result TEXT, at INTEGER NOT NULL, settled_at INTEGER, error TEXT,
        PRIMARY KEY(invocation, name));
CREATE TABLE _asset_gc (asset TEXT PRIMARY KEY) WITHOUT ROWID;
CREATE TABLE _asset_views (asset TEXT NOT NULL, principal TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (asset, principal)) WITHOUT ROWID;
CREATE TABLE _assets (id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, content_type TEXT NOT NULL, bytes INTEGER NOT NULL, width INTEGER, height INTEGER, duration INTEGER, created_at INTEGER NOT NULL, home_table TEXT, home_id TEXT, home_column TEXT, released_at INTEGER);
CREATE TABLE _catalog (name TEXT PRIMARY KEY, num INTEGER NOT NULL UNIQUE);
INSERT INTO "_catalog" VALUES('likes',1);
INSERT INTO "_catalog" VALUES('likes.byId',2);
INSERT INTO "_catalog" VALUES('posts',3);
INSERT INTO "_catalog" VALUES('posts.byId',4);
CREATE TABLE _change_evidence (seq INTEGER PRIMARY KEY, footprint TEXT NOT NULL);
INSERT INTO "_change_evidence" VALUES(1,'{"unknown":false,"tables":{"likes":{"deleted":false,"population":true,"columns":[]},"posts":{"deleted":false,"population":true,"columns":[]}}}');
CREATE TABLE _commits (seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, program TEXT NOT NULL, principal TEXT NOT NULL, kind TEXT NOT NULL, touched TEXT NOT NULL, writes INTEGER NOT NULL);
INSERT INTO "_commits" VALUES(1,1791158247072,'seed','system','seed','["likes","posts"]',2);
CREATE TABLE _credentials (principal TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, hash TEXT NOT NULL);
CREATE TABLE _effect_presence (principal TEXT NOT NULL, id TEXT NOT NULL, deadline INTEGER NOT NULL, reconnected INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (principal, id)) WITHOUT ROWID;
CREATE TABLE _effect_steps (
                 effect_id TEXT NOT NULL, name TEXT NOT NULL, input_digest TEXT NOT NULL,
                 provider_key TEXT NOT NULL, state TEXT NOT NULL, claim_digest TEXT NOT NULL,
                 result TEXT, at INTEGER NOT NULL, settled_at INTEGER, error TEXT,
                 PRIMARY KEY(effect_id, name));
CREATE TABLE _generations (generation INTEGER PRIMARY KEY, schema TEXT NOT NULL, programs TEXT NOT NULL, at INTEGER NOT NULL);
INSERT INTO "_generations" VALUES(1,'{"tables":{"likes":{"columns":{"id":"Id","postId":{"Ref":{"table":"posts"}},"principal":"Principal"},"indexes":{"byId":{"components":[{"Column":"id"}],"unique":true}},"rules":{"read":"Allow","insert":{"Eq":[{"Field":"principal"},"Viewer"]},"update":"Deny","delete":"Deny"},"constraints":[{"Immutable":{"fields":["postId"]}}],"leave":"until-revoked","sync":{"audience":"Public"}},"posts":{"columns":{"authorId":"Principal","id":"Id"},"indexes":{"byId":{"components":[{"Column":"id"}],"unique":true}},"rules":{"read":"Allow","insert":{"Eq":[{"Field":"authorId"},"Viewer"]},"update":"Deny","delete":"Deny"},"constraints":[{"Immutable":{"fields":["authorId"]}}],"leave":"until-revoked","sync":{"audience":"Public"}}},"maintains":[],"auth":{"password":false,"guests":true},"operations":{"like":{"predicts":"eligible","sites":[],"requires":[]},"likes":{"runs":"device","sites":[{"site":"schema.q:21:9 (likes[] first 10)","table":"likes","index":"byId","kind":"scan","class":"held","reason":"scan likes by byId: held, no horizon; selected byId (); result: page; explicit by","rewrite":""}],"requires":[]},"posts":{"runs":"device","sites":[{"site":"schema.q:19:9 (posts[] first 10)","table":"posts","index":"byId","kind":"scan","class":"held","reason":"scan posts by byId: held, no horizon; selected byId (); result: page; explicit by","rewrite":""}],"requires":[]}}}','{"like":{"name":"like","kind":"Mutation","args":{"postId":{"Ref":{"table":"posts"}}},"read_time_granularity_ms":null,"body":[{"Let":{"name":"$value1","value":{"Input":"NewId"}}},{"Const":{"name":"$inserted2","value":{"Object":{"id":{"Variable":"$value1"},"postId":{"Variable":"postId"},"principal":{"Input":"Viewer"}}}}},{"Insert":{"table":"likes","row":{"Variable":"$inserted2"}}},{"Return":{"Variable":"$inserted2"}}]},"likes":{"name":"likes","kind":"Query","args":{},"read_time_granularity_ms":null,"body":[{"Return":{"Scan":{"site":"programs.likes.0","table":"likes","index":"byId","prefix":[],"order":"Asc","take":{"Literal":10},"after":null,"before":null,"range":null,"merge_site":null,"provenance":"Shape"}}}]},"posts":{"name":"posts","kind":"Query","args":{},"read_time_granularity_ms":null,"body":[{"Return":{"Scan":{"site":"programs.posts.0","table":"posts","index":"byId","prefix":[],"order":"Asc","take":{"Literal":10},"after":null,"before":null,"range":null,"merge_site":null,"provenance":"Shape"}}}]}}',1791158247071);
CREATE TABLE _jobs (id TEXT PRIMARY KEY, name TEXT NOT NULL, args TEXT NOT NULL, program_hash TEXT NOT NULL, state TEXT NOT NULL, sweep INTEGER NOT NULL, cursor TEXT, upper TEXT, chunks INTEGER NOT NULL, rows_written INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, error TEXT, chunk_size INTEGER NOT NULL DEFAULT 0, retries INTEGER NOT NULL DEFAULT 0, heap_peak INTEGER NOT NULL DEFAULT 0, domain TEXT);
CREATE TABLE _log (partition TEXT NOT NULL, seq INTEGER NOT NULL, ord INTEGER NOT NULL, t TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT, PRIMARY KEY (partition, seq, ord)) WITHOUT ROWID;
INSERT INTO "_log" VALUES('public',1,0,'posts','put','post1','{"Row":{"authorId":{"Id":"dev:alice"},"id":{"Id":"post1"}}}');
INSERT INTO "_log" VALUES('public',1,1,'likes','put','like1','{"Row":{"id":{"Id":"like1"},"postId":{"Id":"post1"},"principal":{"Id":"dev:alice"}}}');
CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO "_meta" VALUES('version','snapback4-store-1');
INSERT INTO "_meta" VALUES('store_id','0a652e2ef26988f9027f29d93d7e19c8');
INSERT INTO "_meta" VALUES('read_through_shortened','{}');
INSERT INTO "_meta" VALUES('live_sum_candidates','1');
INSERT INTO "_meta" VALUES('schema_hash','3332755018a4eee39994e3e431051a39dc54fcfd0d7af5e37e9c671418f19745');
INSERT INTO "_meta" VALUES('index_keys_validated','2048:04c797e495e9af6fe89d85d049baf890ab173d5b904936a7cc9657be31fa24d4');
INSERT INTO "_meta" VALUES('activation_hash','04c797e495e9af6fe89d85d049baf890ab173d5b904936a7cc9657be31fa24d4');
INSERT INTO "_meta" VALUES('generation','1');
CREATE TABLE _ops (principal TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, outcome TEXT NOT NULL, name TEXT, args_digest TEXT, at INTEGER, PRIMARY KEY (principal, id)) WITHOUT ROWID;
CREATE TABLE _outbox (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, effect TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL, at INTEGER NOT NULL, lease_until INTEGER, claimed_by TEXT, next_at INTEGER, result TEXT, error TEXT, settled_at INTEGER, work_spec TEXT, deadline INTEGER, release TEXT, error_code TEXT, lease_digest TEXT, cancelled INTEGER NOT NULL DEFAULT 0, contract TEXT);
CREATE TABLE _principal_generations (principal TEXT PRIMARY KEY, generation INTEGER NOT NULL);
CREATE TABLE _principals (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT, created_at INTEGER NOT NULL);
CREATE TABLE _requests (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, args TEXT NOT NULL, principal TEXT NOT NULL,
        at INTEGER NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        next_at INTEGER, lease_until INTEGER, claimed_by TEXT, session_digest TEXT,
        result TEXT, error TEXT, family TEXT, principal_generation INTEGER, admitted_expires_at INTEGER, args_digest TEXT, error_code TEXT, settled_at INTEGER, spec TEXT, contract TEXT, deadline INTEGER, release TEXT, service_generation INTEGER, cancelled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE _session_mint_bindings (
            invocation TEXT NOT NULL, intent TEXT NOT NULL, input_digest TEXT NOT NULL,
            principal TEXT NOT NULL, kind TEXT NOT NULL, days INTEGER NOT NULL,
            expires_at INTEGER NOT NULL, family TEXT NOT NULL, principal_generation INTEGER NOT NULL,
            PRIMARY KEY(invocation, intent)
        ) WITHOUT ROWID;
CREATE TABLE _sessions (token_digest TEXT PRIMARY KEY, principal TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, family TEXT);
CREATE TABLE i (ti INTEGER NOT NULL, k BLOB NOT NULL, id TEXT NOT NULL, PRIMARY KEY (ti, k)) WITHOUT ROWID;
INSERT INTO "i" VALUES(2,X'066C696B65310000066C696B65310000','like1');
INSERT INTO "i" VALUES(4,X'06706F737431000006706F7374310000','post1');
CREATE TABLE r (t INTEGER NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (t, id)) WITHOUT ROWID;
INSERT INTO "r" VALUES(1,'like1','{"Row":{"id":{"Id":"like1"},"postId":{"Id":"post1"},"principal":{"Id":"dev:alice"}}}');
INSERT INTO "r" VALUES(3,'post1','{"Row":{"authorId":{"Id":"dev:alice"},"id":{"Id":"post1"}}}');
CREATE INDEX _effect_presence_id ON _effect_presence(id);
CREATE INDEX _sessions_expiry ON _sessions(expires_at);
CREATE INDEX _sessions_family ON _sessions(principal, family, expires_at);
CREATE INDEX _requests_due ON _requests(state, name, at, id);
CREATE INDEX _requests_session ON _requests(session_digest);
CREATE INDEX _outbox_due ON _outbox(state, effect, seq);
CREATE TRIGGER _index_keys_insert_2048 AFTER INSERT ON i WHEN length(NEW.k) > 2048
             BEGIN DELETE FROM _meta WHERE key = 'index_keys_validated'; END;
CREATE TRIGGER _index_keys_update_2048 AFTER UPDATE OF k ON i WHEN length(NEW.k) > 2048
             BEGIN DELETE FROM _meta WHERE key = 'index_keys_validated'; END;
COMMIT;
