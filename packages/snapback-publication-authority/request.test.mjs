import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fetchPublicationAuthorityJson } from './request.mjs';

test('authority client cancels a declared or streamed oversized body', async () => {
  let declaredCancelled = false;
  await assert.rejects(
    fetchPublicationAuthorityJson('https://authority.example/v1/head', {}, {
      maxBytes: 8,
      fetchImpl: async () => new Response(new ReadableStream({
        pull(controller) {
          controller.enqueue(Buffer.from('0123456789'));
        },
        cancel() {
          declaredCancelled = true;
        },
      }), {
        headers: {
          'content-length': '10',
          'content-type': 'application/json',
        },
      }),
    }),
    /byte bound/u,
  );
  assert.equal(declaredCancelled, true);

  let streamedCancelled = false;
  await assert.rejects(
    fetchPublicationAuthorityJson('https://authority.example/v1/head', {}, {
      maxBytes: 8,
      fetchImpl: async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from('0123456789'));
        },
        cancel() {
          streamedCancelled = true;
        },
      }), {
        headers: { 'content-type': 'application/json' },
      }),
    }),
    /byte bound/u,
  );
  assert.equal(streamedCancelled, true);
});

test('authority client aborts a slow body within its deadline', async () => {
  let observedSignal = null;
  await assert.rejects(
    fetchPublicationAuthorityJson('https://authority.example/v1/head', {}, {
      timeoutMs: 10,
      fetchImpl: async (_url, init) => {
        observedSignal = init.signal;
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.from('{"partial":'));
            init.signal.addEventListener('abort', () => {
              controller.error(init.signal.reason);
            });
          },
        }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    }),
    /timed out|aborted/u,
  );
  assert.equal(observedSignal.aborted, true);
});
