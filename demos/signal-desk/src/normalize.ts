import type { Activity, Comment, Incident, Task } from './types';

type Row = Record<string, unknown>;

const value = (row: Row, camel: string, snake: string) => row[camel] ?? row[snake];
const asString = (input: unknown) => String(input ?? '');
const asNumber = (input: unknown) =>
  typeof input === 'number' ? input : new Date(String(input)).getTime();

export function incident(row: Row): Incident {
  return {
    id: asString(row.id ?? row._id),
    title: asString(row.title),
    summary: asString(row.summary),
    severity: asString(row.severity) as Incident['severity'],
    status: asString(row.status) as Incident['status'],
    commanderId: asString(value(row, 'commanderId', 'commander_id')),
    createdAt: asNumber(value(row, 'createdAt', 'created_at')),
    updatedAt: asNumber(value(row, 'updatedAt', 'updated_at')),
  };
}

export function task(row: Row): Task {
  return {
    id: asString(row.id ?? row._id),
    incidentId: asString(value(row, 'incidentId', 'incident_id')),
    body: asString(row.body),
    completed: Boolean(row.completed),
    assigneeId: asString(value(row, 'assigneeId', 'assignee_id')),
    position: Number(row.position),
    createdAt: asNumber(value(row, 'createdAt', 'created_at')),
  };
}

export function comment(row: Row): Comment {
  return {
    id: asString(row.id ?? row._id),
    incidentId: asString(value(row, 'incidentId', 'incident_id')),
    authorId: asString(value(row, 'authorId', 'author_id')),
    body: asString(row.body),
    createdAt: asNumber(value(row, 'createdAt', 'created_at')),
  };
}

export function activity(row: Row): Activity {
  return {
    id: asString(row.id ?? row._id),
    incidentId: asString(value(row, 'incidentId', 'incident_id')),
    actorId: asString(value(row, 'actorId', 'actor_id')),
    kind: asString(row.kind),
    detail: asString(row.detail),
    createdAt: asNumber(value(row, 'createdAt', 'created_at')),
  };
}
