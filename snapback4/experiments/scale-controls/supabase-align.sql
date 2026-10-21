-- Idempotent advocate alignment for databases created from the earlier schema.
-- Same authorization outcomes: authenticated policies stay equivalent, and
-- service_role still bypasses the counter predicate because that role has
-- BYPASSRLS on the invoker path.
BEGIN;
CREATE OR REPLACE FUNCTION private.member_rooms() RETURNS SETOF bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT room FROM sb4scale.memberships
  WHERE principal=(select private.principal_id())
$$;
REVOKE ALL ON FUNCTION private.member_rooms() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.member_rooms() TO authenticated,service_role;

DROP POLICY IF EXISTS member_rooms ON sb4scale.rooms;
CREATE POLICY member_rooms ON sb4scale.rooms FOR SELECT TO authenticated
  USING(id IN (SELECT private.member_rooms()));
DROP POLICY IF EXISTS member_messages ON sb4scale.messages;
CREATE POLICY member_messages ON sb4scale.messages FOR SELECT TO authenticated
  USING(room IN (SELECT private.member_rooms()));
DROP POLICY IF EXISTS member_post ON sb4scale.messages;
CREATE POLICY member_post ON sb4scale.messages FOR INSERT TO authenticated
  WITH CHECK(sender=(select private.principal_id()) AND room IN (SELECT private.member_rooms()));
DROP POLICY IF EXISTS counter_read ON sb4scale.counters;
CREATE POLICY counter_read ON sb4scale.counters FOR SELECT TO authenticated
  USING(owner_id=(select private.principal_id()) OR
    (owner_id IS NULL AND room IN (SELECT private.member_rooms())));
DROP POLICY IF EXISTS counter_write ON sb4scale.counters;
CREATE POLICY counter_write ON sb4scale.counters FOR UPDATE TO authenticated
  USING(owner_id=(select private.principal_id()) OR
    (owner_id IS NULL AND room IN (SELECT private.member_rooms())))
  WITH CHECK(owner_id=(select private.principal_id()) OR
    (owner_id IS NULL AND room IN (SELECT private.member_rooms())));

CREATE OR REPLACE FUNCTION sb4scale.inbox() RETURNS TABLE(room bigint,total bigint,unread bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT m.room,r.total,greatest(0,r.total-m.last_read) FROM sb4scale.memberships m
  JOIN sb4scale.rooms r ON r.id=m.room
  WHERE m.principal=(select private.principal_id()) AND m.room<1024 ORDER BY m.room LIMIT 32
$$;
CREATE OR REPLACE FUNCTION sb4scale.increment(counter_id bigint) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
  UPDATE sb4scale.counters SET n=n+1 WHERE id=counter_id AND (
    coalesce((select current_setting('request.jwt.claims',true)::jsonb->>'role')='service_role',false)
    OR owner_id=(select private.principal_id())
    OR (owner_id IS NULL AND room IN (SELECT private.member_rooms())))
  RETURNING jsonb_build_object('id',id,'n',n)
$$;
REVOKE ALL ON FUNCTION sb4scale.inbox(),sb4scale.increment(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sb4scale.inbox(),sb4scale.increment(bigint) TO authenticated,service_role;
COMMIT;
