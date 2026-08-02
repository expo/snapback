CREATE TABLE field_record (id text PRIMARY KEY, assignment_id text NOT NULL, assigned_to text NOT NULL, title text NOT NULL, body text NOT NULL, checklist_done bigint NOT NULL, revision bigint NOT NULL, conflict text);
CREATE INDEX field_record_assigned_title ON field_record(assigned_to,title,id);
