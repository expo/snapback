-- Deterministic scaled Clique-shaped chat, not a byte replay of scale.log.
-- 256 principals, 1024 ordinary rooms, 32 memberships/principal, one shared room.
BEGIN;
INSERT INTO users SELECT g, 0 FROM generate_series(0,255) g;
INSERT INTO rooms SELECT g, 0 FROM generate_series(0,1024) g;
INSERT INTO memberships SELECT (u*4+j)%1024, u, 0
  FROM generate_series(0,255) u CROSS JOIN generate_series(0,31) j;
INSERT INTO memberships SELECT 1024, u, 0 FROM generate_series(0,255) u;
INSERT INTO counters SELECT u, u, 1024, 0 FROM generate_series(0,255) u;
INSERT INTO counters VALUES (256,NULL,1024,0);
ALTER TABLE messages DISABLE TRIGGER message_totals;
INSERT INTO messages(id,room,sender,at,body)
SELECT g, (g-1)%1024, ((g-1)%1024)/4, 1700000000000+g,
       'message-' || g || ' ' || repeat('chat ',30)
FROM generate_series(1,:rows) g;
ALTER TABLE messages ENABLE TRIGGER message_totals;
SELECT setval(pg_get_serial_sequence('messages','id'), :rows);
UPDATE rooms r SET total=(SELECT count(*) FROM messages m WHERE m.room=r.id);
UPDATE users u SET sent=(SELECT count(*) FROM messages m WHERE m.sender=u.id);
UPDATE memberships m SET last_read=greatest(0,r.total-10) FROM rooms r WHERE m.room=r.id;
COMMIT;
VACUUM ANALYZE;
