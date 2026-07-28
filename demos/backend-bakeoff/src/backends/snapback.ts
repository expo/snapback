import {
  SnapbackClient,
  admitSnapbackId,
  parseSearchQueryV1,
} from '@snapback/client';
import {
  createSnapbackReactProvider,
  invokeSnapbackMutation,
  observeSnapbackQueries,
  type SnapbackReactProvider,
} from '@snapback/react';
import api, {
  ephemeral as generatedEphemeral,
} from '../../snapback/generated/api.mjs';
import schema from '../../snapback/generated/schema.manifest.json';
import functions from '../../snapback/generated/functions.manifest.json';
import capabilityManifest from '../../snapback/generated/capability.manifest.json';
import seed from '../../snapback/seed.json';
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

declare const __SNAPBACK_URL__: string;

export class SnapbackAdapter implements BackendAdapter {
  readonly kind = 'snapback' as const;
  readonly label = 'Snapback';
  readonly transport = 'native WebSocket live queries + ephemeral overlay';
  private client = new SnapbackClient(__SNAPBACK_URL__);
  private provider: SnapbackReactProvider | null = null;
  private providerSettlement: Promise<void> = Promise.resolve();
  private disposers = new Set<Unsubscribe>();

  async setup() {
    await this.client.health();
    await this.client.ensureApp({ schema, functions, seed });
    const binding = await this.client.prepareReactBinding({
      generatedManifest: { functions, capabilityManifest },
    });
    this.provider = createSnapbackReactProvider(binding, {
      connectionId: `bakeoff_react_${crypto.randomUUID()}`,
    });
  }

  async subscribeWorkspace(listener: (snapshot: WorkspaceSnapshot) => void) {
    if (!this.provider) throw new Error('Snapback React provider is not prepared');
    const observer = observeSnapbackQueries(this.provider, {
      incidents: { ref: api.listIncidents, args: {} },
      tasks: { ref: api.allTasks, args: {} },
      comments: { ref: api.allComments, args: {} },
      activity: { ref: api.allActivity, args: {} },
    }, ({ queries }) => {
      const incidents = queries.incidents.status === 'ready'
        || queries.incidents.status === 'refreshing'
        ? queries.incidents.data
        : [];
      const tasks = queries.tasks.status === 'ready'
        || queries.tasks.status === 'refreshing'
        ? queries.tasks.data
        : [];
      const comments = queries.comments.status === 'ready'
        || queries.comments.status === 'refreshing'
        ? queries.comments.data
        : [];
      const activities = queries.activity.status === 'ready'
        || queries.activity.status === 'refreshing'
        ? queries.activity.data
        : [];
      listener({
        incidents: incidents.map(incident),
        tasks: tasks.map(task),
        comments: comments.map(comment),
        activity: activities.map(activity),
      });
    });
    const dispose = () => observer.dispose();
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
    const connectionId = `bakeoff_presence_${crypto.randomUUID()}`;
    const overlay = await this.client.subscribeEphemeral(generatedEphemeral.incidentPresence, {
      connectionId,
      scope: { incidentId },
    });
    const emit = () =>
      listener(
        overlay.currentEntries().map((entry) => ({
          key: entry.key,
          ...entry.value,
        })),
      );
    const off = overlay.onChange((result: string) => {
      if (result !== 'needs_resync') emit();
    });
    const value = {
      userId: persona.id,
      name: persona.name,
      color: persona.color,
      viewing: 'incident',
    };
    await overlay.publish(value, { ttlMs: 30_000 });
    emit();
    const pulse = setInterval(() => {
      void overlay.publish(value, { ttlMs: 30_000 });
    }, 10_000);
    const dispose = () => {
      clearInterval(pulse);
      off();
      overlay.dispose();
    };
    this.disposers.add(dispose);
    return () => {
      this.disposers.delete(dispose);
      dispose();
    };
  }

  async createIncident(input: { actorId: string; title: string; severity: Severity }) {
    if (!this.provider) throw new Error('Snapback React provider is not prepared');
    return String(await invokeSnapbackMutation(this.provider, api.createIncident, {
      ...input,
      now: Date.now(),
    }));
  }
  async addTask(input: { actorId: string; incidentId: string; body: string }) {
    if (!this.provider) throw new Error('Snapback React provider is not prepared');
    await invokeSnapbackMutation(this.provider, api.addTask, {
      ...input,
      incidentId: admitSnapbackId('incidents', input.incidentId),
      now: Date.now(),
    });
  }
  async toggleTask(input: {
    actorId: string;
    incidentId: string;
    taskId: string;
    completed: boolean;
  }) {
    if (!this.provider) throw new Error('Snapback React provider is not prepared');
    await invokeSnapbackMutation(this.provider, api.toggleTask, {
      ...input,
      incidentId: admitSnapbackId('incidents', input.incidentId),
      taskId: admitSnapbackId('tasks', input.taskId),
      now: Date.now(),
    });
  }
  async addComment(input: { actorId: string; incidentId: string; body: string }) {
    if (!this.provider) throw new Error('Snapback React provider is not prepared');
    await invokeSnapbackMutation(this.provider, api.addComment, {
      ...input,
      incidentId: admitSnapbackId('incidents', input.incidentId),
      now: Date.now(),
    });
  }
  async setStatus(input: {
    actorId: string;
    incidentId: string;
    status: IncidentStatus;
  }) {
    if (!this.provider) throw new Error('Snapback React provider is not prepared');
    await invokeSnapbackMutation(this.provider, api.setStatus, {
      ...input,
      incidentId: admitSnapbackId('incidents', input.incidentId),
      now: Date.now(),
    });
  }
  async searchIncidents(term: string) {
    const result = await this.client.search(api.searchIncidents, {
      query: parseSearchQueryV1(term, {
        fields: ['title', 'summary', 'severity', 'status'],
      }),
    });
    return result.items.map((item) =>
      incident({ _id: item.rowId, ...item.fields }));
  }
  async generateBrief(incidentId: string) {
    const result = await this.client.query(api.generateBrief, {
      args: { incidentId: admitSnapbackId('incidents', incidentId) },
    });
    return String(result.rows[0]?.brief ?? '');
  }
  dispose() {
    for (const dispose of this.disposers) dispose();
    this.disposers.clear();
    if (this.provider) {
      this.providerSettlement = this.provider.dispose();
      this.provider = null;
    }
  }
  async settled() {
    await this.providerSettlement;
  }
}
