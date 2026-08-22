import assert from 'node:assert/strict';

import {
  defineStarterAcceptance,
  runStarterAcceptanceIfMain,
} from '@expo/snapback-acceptance';
import api from './snapback/generated/api.mjs';
import artifacts from './snapback/generated/artifacts.json' with { type: 'json' };

export const acceptance = defineStarterAcceptance({
  acceptanceFile: import.meta.url,
  appRoot: import.meta.dirname,
  artifacts,
  paths: {
    projectDirectory: {
      id: 'relational-project-directory',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: api.projectDirectory,
      provenance: 'baseline',
    },
    createProject: {
      id: 'create-project',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: api.createProject,
      provenance: 'baseline',
    },
    updateProject: {
      id: 'update-project-live-detail',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: api.updateProject,
    },
    deleteProject: {
      id: 'delete-project',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: api.deleteProject,
    },
  },
  async journey({ adminClient, defer, paths, step }) {
    let createdProjectId = null;
    let detail = null;
    defer(() => detail?.dispose());

    await step(paths.projectDirectory, async () => {
      const initial = await adminClient.query(api.projectDirectory, { args: {} });
      assert.ok(initial.rows.length >= 3);
      assert.ok(initial.rows.every((row) => typeof row.teamName === 'string'));
      return { rows: initial.rows.length };
    });

    await step(paths.createProject, async () => {
      const created = await adminClient.mutate(api.createProject, {
        args: {
          teamSlug: 'studio',
          title: 'Acceptance mosaic',
          summary: 'Created through generated CRUD.',
          status: 'active',
          budget: 19000,
        },
      });
      assert.equal(typeof created.result, 'string');
      createdProjectId = created.result;
      return { projectId: createdProjectId };
    });

    await step(paths.updateProject, async () => {
      detail = await adminClient.liveQuery(api.projectDetail, {
        args: { projectKey: createdProjectId },
        connectionId: 'crud-dashboard-detail',
      });
      await adminClient.mutate(api.updateProject, {
        args: {
          projectKey: createdProjectId,
          teamSlug: 'platform',
          title: 'Acceptance mosaic revised',
          summary: 'Updated through generated CRUD.',
          status: 'done',
          budget: 21000,
        },
      });
      const updated = (await detail.poll()).find((row) => row.status === 'done');
      assert.ok(updated, 'updated project must be visible on the first live-detail poll');
      assert.equal(updated.title, 'Acceptance mosaic revised');
      return { observedBy: api.projectDetail.id };
    });

    await step(paths.deleteProject, async () => {
      await adminClient.mutate(api.deleteProject, { args: { projectKey: createdProjectId } });
      assert.equal(
        (await detail.poll()).length,
        0,
        'deleted project must be absent on the first live-detail poll',
      );
      return { deleted: true };
    });
  },
});

await runStarterAcceptanceIfMain(import.meta, acceptance);
