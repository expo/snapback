import {
  SnapbackClient,
  admitSnapbackId,
  parseSearchQueryV1,
  type PreparedReactQueryGroup,
} from '@snapback/client';
import {
  createSnapbackReactProvider,
  invokeSnapbackMutation,
  observeSnapbackPresence,
  observeSnapbackQueries,
  type SnapbackReactProvider,
} from '@snapback/react';
import api, {
  ephemeral as generatedEphemeral,
  groups as generatedGroups,
} from '../../snapback/generated/api.mjs';
import schema from '../../snapback/generated/schema.manifest.json';
import functions from '../../snapback/generated/functions.manifest.json';
import capabilityManifest from '../../snapback/generated/capability.manifest.json';
import routes from '../../snapback/generated/routes.manifest.json';
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
  private workspaceGroup:
    PreparedReactQueryGroup<typeof generatedGroups['/']> | null = null;
  private providerSettlement: Promise<void> = Promise.resolve();
  private disposers = new Set<Unsubscribe>();

  async setup() {
    await this.client.health();
    const binding = await this.client.prepareReactBinding({
      generatedManifest: { schema, functions, capabilityManifest, routes },
    });
    this.workspaceGroup = await binding.prepareQueryGroup(
      generatedGroups['/'],
      {},
      { fallbackToLive: true, userId: 'bakeoff-react' },
    );
    this.provider = createSnapbackReactProvider(binding, {
      preparedGroup: this.workspaceGroup,
    });
  }

  async subscribeWorkspace(listener: (snapshot: WorkspaceSnapshot) => void) {
    if (!this.provider || !this.workspaceGroup) {
      throw new Error('Snapback React provider is not prepared');
    }
    const observer = observeSnapbackQueries(
      this.provider,
      this.workspaceGroup,
      ({ queries }) => {
        const incidents = queries.listIncidents.status === 'ready'
          || queries.listIncidents.status === 'refreshing'
          ? queries.listIncidents.data
          : [];
        const tasks = queries.allTasks.status === 'ready'
          || queries.allTasks.status === 'refreshing'
          ? queries.allTasks.data
          : [];
        const comments = queries.allComments.status === 'ready'
          || queries.allComments.status === 'refreshing'
          ? queries.allComments.data
          : [];
        const activities = queries.allActivity.status === 'ready'
          || queries.allActivity.status === 'refreshing'
          ? queries.allActivity.data
          : [];
        listener({
          incidents: incidents.map(incident),
          tasks: tasks.map(task),
          comments: comments.map(comment),
          activity: activities.map(activity),
        });
      },
    );
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
    if (!this.provider) throw new Error('Snapback React provider is not prepared');
    const observer = observeSnapbackPresence(
      this.provider,
      generatedEphemeral.incidentPresence,
      {
        scope: { incidentId },
        value: {
          userId: persona.id,
          name: persona.name,
          color: persona.color,
          viewing: 'incident',
        },
      },
      (state) => {
        listener((state.status === 'ready' || state.status === 'stale'
          ? state.entries
          : []).map((entry) => ({
          key: entry.key,
          ...entry.value,
        })));
      },
    );
    const dispose = () => {
      void observer.dispose();
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
    }, {
      optimistic: {
        query: api.allTasks,
        args: {},
        update: (current) => current.map((row) => (
          row._id === input.taskId ? { ...row, completed: input.completed } : row
        )),
        isAuthoritative: (current, taskId) => current.some((row) => (
          row._id === taskId && row.completed === input.completed
        )),
      },
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
      this.workspaceGroup = null;
    }
  }
  async settled() {
    await this.providerSettlement;
  }
}
