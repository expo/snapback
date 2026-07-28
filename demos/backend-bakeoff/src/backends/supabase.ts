import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
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

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_KEY__: string;

export class SupabaseAdapter implements BackendAdapter {
  readonly kind = 'supabase' as const;
  readonly label = 'Supabase';
  readonly transport = 'Postgres Changes + Realtime Presence';
  private client: SupabaseClient;
  private channels = new Set<RealtimeChannel>();

  constructor() {
    if (!__SUPABASE_URL__ || !__SUPABASE_KEY__) {
      throw new Error('SUPABASE_URL and a publishable/anon key are not configured');
    }
    this.client = createClient(__SUPABASE_URL__, __SUPABASE_KEY__);
  }

  async setup() {
    const { error } = await this.client.from('bakeoff_incidents').select('id').limit(1);
    if (error) throw error;
  }

  private async load(): Promise<WorkspaceSnapshot> {
    const [incidents, tasks, comments, activities] = await Promise.all([
      this.client.from('bakeoff_incidents').select('*').order('updated_at', { ascending: false }),
      this.client.from('bakeoff_tasks').select('*').order('position'),
      this.client.from('bakeoff_comments').select('*').order('created_at'),
      this.client.from('bakeoff_activity').select('*').order('created_at', { ascending: false }),
    ]);
    for (const result of [incidents, tasks, comments, activities]) {
      if (result.error) throw result.error;
    }
    return {
      incidents: (incidents.data ?? []).map(incident),
      tasks: (tasks.data ?? []).map(task),
      comments: (comments.data ?? []).map(comment),
      activity: (activities.data ?? []).map(activity),
    };
  }

  async subscribeWorkspace(listener: (snapshot: WorkspaceSnapshot) => void) {
    let queued: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const reload = () => {
      if (queued) clearTimeout(queued);
      queued = setTimeout(() => {
        queued = null;
        void this.load().then((snapshot) => {
          if (!disposed) listener(snapshot);
        });
      }, 30);
    };
    listener(await this.load());
    let channel = this.client.channel(`signal-desk-data-${crypto.randomUUID()}`);
    for (const table of [
      'bakeoff_incidents',
      'bakeoff_tasks',
      'bakeoff_comments',
      'bakeoff_activity',
    ]) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        reload,
      );
    }
    await channel.subscribe();
    this.channels.add(channel);
    return () => {
      disposed = true;
      if (queued) clearTimeout(queued);
      this.channels.delete(channel);
      void this.client.removeChannel(channel);
    };
  }

  async subscribePresence(
    incidentId: string,
    persona: Persona,
    listener: (presence: Presence[]) => void,
  ) {
    const key = `${persona.id}:${crypto.randomUUID()}`;
    const channel = this.client.channel(`signal-desk-presence:${incidentId}`, {
      config: { presence: { key } },
    });
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<Record<string, unknown>>();
      const rows = Object.entries(state).flatMap(([presenceKey, entries]) =>
        entries.map((entry) => ({
          key: presenceKey,
          userId: String(entry.userId),
          name: String(entry.name),
          color: String(entry.color),
          viewing: String(entry.viewing),
        })),
      );
      listener(rows);
    });
    await channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          userId: persona.id,
          name: persona.name,
          color: persona.color,
          viewing: 'incident',
        });
      }
    });
    this.channels.add(channel);
    return () => {
      this.channels.delete(channel);
      void channel.untrack();
      void this.client.removeChannel(channel);
    };
  }

  private async rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) throw error;
    return data;
  }
  async createIncident(input: { actorId: string; title: string; severity: Severity }) {
    return String(
      await this.rpc('bakeoff_create_incident', {
        p_actor_id: input.actorId,
        p_title: input.title,
        p_severity: input.severity,
        p_at_ms: Date.now(),
      }),
    );
  }
  async addTask(input: { actorId: string; incidentId: string; body: string }) {
    await this.rpc('bakeoff_add_task', {
      p_actor_id: input.actorId,
      p_incident_id: input.incidentId,
      p_body: input.body,
      p_at_ms: Date.now(),
    });
  }
  async toggleTask(input: {
    actorId: string;
    incidentId: string;
    taskId: string;
    completed: boolean;
  }) {
    await this.rpc('bakeoff_toggle_task', {
      p_actor_id: input.actorId,
      p_incident_id: input.incidentId,
      p_task_id: input.taskId,
      p_completed: input.completed,
      p_at_ms: Date.now(),
    });
  }
  async addComment(input: { actorId: string; incidentId: string; body: string }) {
    await this.rpc('bakeoff_add_comment', {
      p_actor_id: input.actorId,
      p_incident_id: input.incidentId,
      p_body: input.body,
      p_at_ms: Date.now(),
    });
  }
  async setStatus(input: {
    actorId: string;
    incidentId: string;
    status: IncidentStatus;
  }) {
    await this.rpc('bakeoff_set_status', {
      p_actor_id: input.actorId,
      p_incident_id: input.incidentId,
      p_status: input.status,
      p_at_ms: Date.now(),
    });
  }
  async searchIncidents(term: string) {
    let query = this.client
      .from('bakeoff_incidents')
      .select('*')
      .order('updated_at', { ascending: false });
    if (term.trim()) query = query.textSearch('search_document', term, { type: 'websearch' });
    const { data, error } = await query.limit(20);
    if (error) throw error;
    return (data ?? []).map(incident);
  }
  async generateBrief(incidentId: string) {
    return String(await this.rpc('bakeoff_generate_brief', { p_incident_id: incidentId }));
  }
  dispose() {
    for (const channel of this.channels) void this.client.removeChannel(channel);
    this.channels.clear();
  }
}
