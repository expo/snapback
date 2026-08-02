CREATE TABLE incident (id text PRIMARY KEY, title text NOT NULL, severity text NOT NULL, created_by text NOT NULL, next_sequence bigint NOT NULL);
CREATE TABLE incident_member (id text PRIMARY KEY, incident_id text NOT NULL REFERENCES incident(id) ON DELETE CASCADE, user_id text NOT NULL, role text NOT NULL, UNIQUE(incident_id,user_id));
CREATE INDEX incident_member_user_incident ON incident_member(user_id,incident_id);
CREATE TABLE message (id text PRIMARY KEY, incident_id text NOT NULL REFERENCES incident(id) ON DELETE CASCADE, sequence bigint NOT NULL, author_id text NOT NULL, body text NOT NULL, UNIQUE(incident_id,sequence));
CREATE INDEX message_incident_sequence ON message(incident_id,sequence);
CREATE TABLE task (id text PRIMARY KEY, incident_id text NOT NULL REFERENCES incident(id) ON DELETE CASCADE, title text NOT NULL, done bigint NOT NULL);
CREATE TABLE note (id text PRIMARY KEY, incident_id text NOT NULL REFERENCES incident(id) ON DELETE CASCADE, author_id text NOT NULL, body text NOT NULL);
