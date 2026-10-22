-- RT5 test/experiment-only fixture. Never installed by attach.
-- @ref LLP 3000.009.001.000.001#35-each-command-keeps-its-own-place — later statements must refresh after a head-lock wait.
CREATE TABLE _rt5_owner (singleton boolean PRIMARY KEY, token bigint NOT NULL);
INSERT INTO _rt5_owner VALUES (true,1);
CREATE TABLE _rt5_head (singleton boolean PRIMARY KEY, seq bigint NOT NULL);
INSERT INTO _rt5_head VALUES (true,0);
CREATE TABLE _rt5_generation (singleton boolean PRIMARY KEY, generation bigint NOT NULL);
INSERT INTO _rt5_generation VALUES (true,1);
CREATE TABLE _rt5_authority (digest text PRIMARY KEY, principal text NOT NULL, expires bigint NOT NULL);
INSERT INTO _rt5_authority VALUES ('digest','before',9223372036854775807);
CREATE TABLE _rt5_receipts (op text PRIMARY KEY, outcome text NOT NULL);
CREATE TABLE _rt5_messages (id integer PRIMARY KEY, room integer NOT NULL, value bigint NOT NULL);
CREATE TABLE _rt5_memberships (room integer PRIMARY KEY, principal text NOT NULL);
INSERT INTO _rt5_messages SELECT n,n,0 FROM generate_series(0,31) n;
INSERT INTO _rt5_memberships SELECT n,'before' FROM generate_series(0,31) n;

CREATE FUNCTION sb4_fence(wanted bigint) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
DECLARE actual bigint;
BEGIN
 SELECT token INTO STRICT actual FROM _rt5_owner WHERE singleton FOR KEY SHARE;
 IF actual <> wanted THEN RAISE EXCEPTION 'owner fence mismatch' USING ERRCODE='55000'; END IF;
END $$;

CREATE FUNCTION sb4_generation(wanted bigint) RETURNS bigint LANGUAGE plpgsql VOLATILE AS $$
DECLARE actual bigint;
BEGIN
 SELECT generation INTO STRICT actual FROM _rt5_generation WHERE singleton;
 IF actual <> wanted THEN RAISE EXCEPTION 'generation mismatch' USING ERRCODE='40001'; END IF;
 RETURN actual;
END $$;

-- Every read after the lock is a distinct PL/pgSQL statement.
CREATE FUNCTION sb4_open(wanted_token bigint, wanted_generation bigint, bearer text, at_time bigint, operation text)
RETURNS TABLE(head bigint, generation bigint, principal text, receipt text)
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
 PERFORM sb4_fence(wanted_token);
 SELECT h.seq INTO STRICT head FROM _rt5_head h WHERE h.singleton FOR UPDATE;
 SELECT sb4_generation(wanted_generation) INTO generation;
 SELECT a.principal INTO principal FROM _rt5_authority a WHERE a.digest=bearer AND a.expires>at_time;
 SELECT r.outcome INTO receipt FROM _rt5_receipts r WHERE r.op=operation;
 RETURN NEXT;
END $$;

-- Diagnostic one-statement SQL envelope: same lock then later-looking reads,
-- but all use the snapshot taken before that lock wait.
CREATE FUNCTION sb4_open_sql(wanted_token bigint, wanted_generation bigint, bearer text, at_time bigint, operation text)
RETURNS TABLE(head bigint, generation bigint, principal text, receipt text)
LANGUAGE sql VOLATILE AS $$
 SELECT h.seq,g.generation,a.principal,r.outcome
 FROM (SELECT seq FROM _rt5_head WHERE singleton FOR UPDATE) h
 CROSS JOIN _rt5_generation g
 LEFT JOIN _rt5_authority a ON a.digest=bearer AND a.expires>at_time
 LEFT JOIN _rt5_receipts r ON r.op=operation WHERE g.singleton
$$;

CREATE FUNCTION sb4_read(bearer text, at_time bigint, message integer)
RETURNS TABLE(principal text, generation bigint, head bigint, room integer, value bigint)
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
 SELECT a.principal INTO principal FROM _rt5_authority a WHERE a.digest=bearer AND a.expires>at_time;
 SELECT g.generation,h.seq INTO generation,head FROM _rt5_generation g CROSS JOIN _rt5_head h WHERE g.singleton AND h.singleton;
 SELECT m.room,m.value INTO room,value FROM _rt5_messages m WHERE m.id=message;
 RETURN NEXT;
END $$;

CREATE FUNCTION sb4_tail(previous bigint) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
BEGIN
 UPDATE _rt5_head SET seq=seq+1 WHERE singleton AND seq=previous;
 IF NOT FOUND THEN RAISE EXCEPTION 'zero-row tail' USING ERRCODE='55000'; END IF;
END $$;
