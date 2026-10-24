-- Isolated M1 fixture only. Copies tagged r.data images into native types.
SET search_path=sb4_eval_m1,pg_catalog;

DROP TABLE IF EXISTS typed_counters,typed_messages,typed_memberships,typed_users,typed_rooms;
CREATE TABLE typed_users (id text COLLATE "C" PRIMARY KEY, principal text COLLATE "C" NOT NULL UNIQUE, sent bigint NOT NULL);
CREATE TABLE typed_rooms (id text COLLATE "C" PRIMARY KEY, total bigint NOT NULL);
CREATE TABLE typed_memberships (id text COLLATE "C" PRIMARY KEY, room text COLLATE "C" NOT NULL REFERENCES typed_rooms, principal text COLLATE "C" NOT NULL, last_read bigint NOT NULL, UNIQUE(room,principal));
CREATE INDEX ON typed_memberships(principal,room,id);
CREATE TABLE typed_messages (id text COLLATE "C" PRIMARY KEY, room text COLLATE "C" NOT NULL REFERENCES typed_rooms, sender text COLLATE "C" NOT NULL REFERENCES typed_users, at bigint NOT NULL, body text NOT NULL);
CREATE INDEX ON typed_messages(room,at,id);
CREATE INDEX ON typed_messages(sender);
CREATE TABLE typed_counters (id text COLLATE "C" PRIMARY KEY, owner text COLLATE "C", room text COLLATE "C" NOT NULL REFERENCES typed_rooms, n bigint NOT NULL);
CREATE INDEX ON typed_counters(owner,room,id);
ALTER TABLE typed_users SET (autovacuum_enabled=false);
ALTER TABLE typed_rooms SET (autovacuum_enabled=false);
ALTER TABLE typed_memberships SET (autovacuum_enabled=false);
ALTER TABLE typed_messages SET (autovacuum_enabled=false);
ALTER TABLE typed_counters SET (autovacuum_enabled=false);
INSERT INTO typed_users SELECT id,(data::jsonb #>> '{Row,principal,Id}'),(data::jsonb #>> '{Row,sent,Int}')::bigint FROM r WHERE t='users';
INSERT INTO typed_rooms SELECT id,(data::jsonb #>> '{Row,total,Int}')::bigint FROM r WHERE t='rooms';
INSERT INTO typed_memberships SELECT id,(data::jsonb #>> '{Row,room,Id}'),(data::jsonb #>> '{Row,principal,Id}'),(data::jsonb #>> '{Row,last_read,Int}')::bigint FROM r WHERE t='memberships';
INSERT INTO typed_messages SELECT id,(data::jsonb #>> '{Row,room,Id}'),(data::jsonb #>> '{Row,sender,Id}'),(data::jsonb #>> '{Row,at,Int}')::bigint,(data::jsonb #>> '{Row,body,String}') FROM r WHERE t='messages';
INSERT INTO typed_counters SELECT id,(data::jsonb #>> '{Row,owner,Id}'),(data::jsonb #>> '{Row,room,Id}'),(data::jsonb #>> '{Row,n,Int}')::bigint FROM r WHERE t='counters';
