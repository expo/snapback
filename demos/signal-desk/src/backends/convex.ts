import { ConvexClient } from 'convex/browser';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { activity, comment, incident, task } from '../normalize';
import type {
  BackendAdapter,
  IncidentStatus,
  Persona,
  Presence,
  Severity,
  Unsubscribe,
  WorkspaceSnapshot,
} from '../types';

declare const __CONVEX_URL__: string;

export class ConvexAdapter implements BackendAdapter {
  readonly kind = 'convex' as const;
  readonly label = 'Convex';
  readonly transport = 'native Convex reactive query subscriptions';
  private client: ConvexClient;
  private disposers = new Set<Unsubscribe>();

  constructor() {
    if (!__CONVEX_URL__) throw new Error('VITE_CONVEX_URL is not configured');
    this.client = new ConvexClient(__CONVEX_URL__);
  }

  async setup() {
    await this.client.mutation(api.incidents.seed, {});
  }

  async subscribeWorkspace(listener: (snapshot: WorkspaceSnapshot) => void) {
    const current: WorkspaceSnapshot = { incidents: [], tasks: [], comments: [], activity: [] };
    const emit = () => listener(structuredClone(current));
    const offs = [
      this.client.onUpdate(api.incidents.list, {}, (rows) => {
        current.incidents = rows.filter(Boolean).map((row) => incident(row as never));
        emit();
      }),
      this.client.onUpdate(api.incidents.allTasks, {}, (rows) => {
        current.tasks = rows.map((row) => task(row as never));
        emit();
      }),
      this.client.onUpdate(api.incidents.allComments, {}, (rows) => {
        current.comments = rows.map((row) => comment(row as never));
        emit();
      }),
      this.client.onUpdate(api.incidents.allActivity, {}, (rows) => {
        current.activity = rows.map((row) => activity(row as never));
        emit();
      }),
    ];
    const dispose = () => offs.forEach((off) => off());
    this.disposers.add(dispose);
    return () => {
      this.disposers.delete(dispose);
      dispose();
    };
  }

  async subscribePresence(
    incidentId: string,
    persona: Persona,
    listener: (presence: Presence[]) => void,
  ) {
    const connectionId = `convex_${crypto.randomUUID()}`;
    const heartbeat = () =>
      this.client.mutation(api.incidents.heartbeat, {
        connectionId,
        incidentId: incidentId as Id<'incidents'>,
        userId: persona.id,
        name: persona.name,
        color: persona.color,
        viewing: 'incident',
        now: Date.now(),
      });
    await heartbeat();
    const off = this.client.onUpdate(
      api.incidents.presence,
      { incidentId: incidentId as Id<'incidents'>, after: Date.now() - 20_000 },
      (rows) => listener(rows.map((row) => ({ ...row, key: row.connectionId }))),
    );
    const pulse = setInterval(() => void heartbeat(), 8_000);
    const dispose = () => {
      clearInterval(pulse);
      off();
      void this.client.mutation(api.incidents.leavePresence, { connectionId });
    };
    this.disposers.add(dispose);
    return () => {
      this.disposers.delete(dispose);
      dispose();
    };
  }

  async createIncident(input: { actorId: string; title: string; severity: Severity }) {
    return this.client.mutation(api.incidents.create, { ...input, now: Date.now() });
  }
  async addTask(input: { actorId: string; incidentId: string; body: string }) {
    await this.client.mutation(api.incidents.addTask, {
      ...input,
      incidentId: input.incidentId as Id<'incidents'>,
      now: Date.now(),
    });
  }
  async toggleTask(input: {
    actorId: string;
    incidentId: string;
    taskId: string;
    completed: boolean;
  }) {
    await this.client.mutation(api.incidents.toggleTask, {
      ...input,
      incidentId: input.incidentId as Id<'incidents'>,
      taskId: input.taskId as Id<'tasks'>,
      now: Date.now(),
    });
  }
  async addComment(input: { actorId: string; incidentId: string; body: string }) {
    await this.client.mutation(api.incidents.addComment, {
      ...input,
      incidentId: input.incidentId as Id<'incidents'>,
      now: Date.now(),
    });
  }
  async setStatus(input: {
    actorId: string;
    incidentId: string;
    status: IncidentStatus;
  }) {
    await this.client.mutation(api.incidents.setStatus, {
      ...input,
      incidentId: input.incidentId as Id<'incidents'>,
      now: Date.now(),
    });
  }
  async searchIncidents(term: string) {
    const rows = await this.client.query(api.incidents.search, { term });
    return rows.filter(Boolean).map((row) => incident(row as never));
  }
  async generateBrief(incidentId: string) {
    return this.client.query(api.incidents.brief, {
      incidentId: incidentId as Id<'incidents'>,
    });
  }
  dispose() {
    for (const dispose of this.disposers) dispose();
    this.disposers.clear();
    void this.client.close();
  }
}
