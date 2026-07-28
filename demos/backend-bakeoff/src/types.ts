export type BackendKind = 'snapback' | 'convex' | 'supabase';
export type Severity = 'SEV-1' | 'SEV-2' | 'SEV-3';
export type IncidentStatus = 'investigating' | 'monitoring' | 'resolved';

export interface Persona {
  id: string;
  name: string;
  initials: string;
  color: string;
}

export const PERSONAS: Persona[] = [
  { id: 'user_ada', name: 'Ada', initials: 'AD', color: '#f0544f' },
  { id: 'user_grace', name: 'Grace', initials: 'GH', color: '#5f8dff' },
  { id: 'user_lin', name: 'Lin', initials: 'LP', color: '#37b07b' },
];

export interface Incident {
  id: string;
  title: string;
  summary: string;
  severity: Severity;
  status: IncidentStatus;
  commanderId: string;
  createdAt: number;
  updatedAt: number;
}

export interface Task {
  id: string;
  incidentId: string;
  body: string;
  completed: boolean;
  assigneeId: string;
  position: number;
  createdAt: number;
}

export interface Comment {
  id: string;
  incidentId: string;
  authorId: string;
  body: string;
  createdAt: number;
}

export interface Activity {
  id: string;
  incidentId: string;
  actorId: string;
  kind: string;
  detail: string;
  createdAt: number;
}

export interface Presence {
  key: string;
  userId: string;
  name: string;
  color: string;
  viewing: string;
}

export interface WorkspaceSnapshot {
  incidents: Incident[];
  tasks: Task[];
  comments: Comment[];
  activity: Activity[];
}

export interface Unsubscribe {
  (): void;
}

export interface BackendAdapter {
  kind: BackendKind;
  label: string;
  transport: string;
  setup(): Promise<void>;
  subscribeWorkspace(listener: (snapshot: WorkspaceSnapshot) => void): Promise<Unsubscribe>;
  subscribePresence(
    incidentId: string,
    persona: Persona,
    listener: (presence: Presence[]) => void,
  ): Promise<Unsubscribe>;
  createIncident(input: {
    actorId: string;
    title: string;
    severity: Severity;
  }): Promise<string>;
  addTask(input: { actorId: string; incidentId: string; body: string }): Promise<void>;
  toggleTask(input: {
    actorId: string;
    incidentId: string;
    taskId: string;
    completed: boolean;
  }): Promise<void>;
  addComment(input: { actorId: string; incidentId: string; body: string }): Promise<void>;
  setStatus(input: {
    actorId: string;
    incidentId: string;
    status: IncidentStatus;
  }): Promise<void>;
  searchIncidents(term: string): Promise<Incident[]>;
  generateBrief(incidentId: string): Promise<string>;
  dispose(): void;
}
