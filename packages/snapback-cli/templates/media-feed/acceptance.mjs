import assert from 'node:assert/strict';

import {
  defineStarterAcceptance,
  runStarterAcceptanceIfMain,
} from '@expo/snapback-acceptance';
import { createAssetClient } from '@expo/snapback-client/assets';
import api from './snapback/generated/api.mjs';
import artifacts from './snapback/generated/artifacts.json' with { type: 'json' };

export const acceptance = defineStarterAcceptance({
  acceptanceFile: import.meta.url,
  appRoot: import.meta.dirname,
  artifacts,
  paths: {
    liveFeed: {
      id: 'retained-live-feed-pages',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: api.liveFeed,
      provenance: 'baseline',
    },
    createEntry: {
      id: 'session-upload-and-typed-attach',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: api.createEntry,
      provenance: 'baseline',
    },
    thumbnail: {
      id: 'thumbnail-rendition-delivery',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: null,
    },
    display: {
      id: 'display-rendition-delivery',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: null,
    },
  },
  async journey({ createSessionClient, defer, paths, ready, step }) {
    const client = await createSessionClient({ email: 'acceptance@media-feed.test' });
    let feed = null;
    defer(() => feed?.dispose());
    let older;
    let boundary;
    let finished;
    let created;

    await step(paths.liveFeed, async () => {
      const first = await client.query(api.liveFeed, { args: {} });
      assert.equal(first.rows.length, 6);
      assert.deepEqual(
        first.rows.map((row) => row.pageKey),
        [...first.rows.map((row) => row.pageKey)].sort().reverse(),
      );
      boundary = first.rows.at(-1).pageKey;
      older = await client.query(api.olderFeedPage, { args: { before: boundary } });
      assert.equal(older.rows.length, 6);
      assert.deepEqual(
        older.rows.map((row) => row.pageKey),
        [...older.rows.map((row) => row.pageKey)].sort().reverse(),
      );
      assert.equal(first.rows.at(-1).createdAt, older.rows[0].createdAt);
      assert.equal(new Set([...first.rows, ...older.rows].map((row) => row._id)).size, 12);
      feed = await client.liveQuery(api.liveFeed, {
        args: {},
        connectionId: 'media-feed-acceptance',
      });
      return {
        first: first.rows.length,
        older: older.rows.length,
        uniqueBoundary: 'pageKey',
        equalTimestampBoundary: true,
      };
    });

    await step(paths.createEntry, async () => {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      );
      const upload = createAssetClient(client).start({
        upload: api.feedPhotoUpload,
        file: new Blob([png], { type: 'image/png' }),
        declaredFilename: 'acceptance.png',
        declaredContentType: 'image/png',
      });
      finished = await upload.done;
      assert.equal(finished.status, 'ready', JSON.stringify(finished.diagnostic));
      created = await client.mutate(api.createEntry, {
        args: {
          authorName: 'Acceptance',
          caption: 'Uploaded through typed custody.',
          photo: finished.assetId,
        },
      });
      const olderAfterInsert = await client.query(api.olderFeedPage, { args: { before: boundary } });
      assert.deepEqual(
        olderAfterInsert.rows.map((row) => row._id),
        older.rows.map((row) => row._id),
        'a newer concurrent insert does not shift the historical page',
      );
      const observed = (await feed.poll()).find((row) => row._id === created.result);
      assert.ok(observed, 'uploaded feed entry must be visible on the first live-feed poll');
      assert.equal(observed.photo, finished.assetId);
      return {
        assetId: finished.assetId,
        entryId: created.result,
        newerInsertStable: true,
      };
    });

    for (const [key, rendition] of [['thumbnail', 'thumb'], ['display', 'display']]) {
      await step(paths[key], async () => {
        const response = await fetch(
          `${ready.serverUrl}/assets/public/${encodeURIComponent(finished.assetId)}/${rendition}`,
        );
        assert.equal(response.status, 200, `${rendition} rendition must serve`);
        assert.equal(response.headers.get('content-type'), 'image/png');
        return { status: response.status, rendition };
      });
    }
  },
});

await runStarterAcceptanceIfMain(import.meta, acceptance);
