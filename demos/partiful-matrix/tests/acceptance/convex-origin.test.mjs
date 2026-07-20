import assert from 'node:assert/strict';
import test from 'node:test';

import { convexDeploymentUrl } from '../../backends/gateway/convex.ts';

test('normalizes Convex cloud and site origins', () => {
  assert.equal(
    convexDeploymentUrl('https://example-deployment.convex.cloud/'),
    'https://example-deployment.convex.cloud',
  );
  assert.equal(
    convexDeploymentUrl('https://example-deployment.convex.site////'),
    'https://example-deployment.convex.cloud',
  );
  assert.equal(
    convexDeploymentUrl('dev:example-deployment|not-a-real-secret'),
    'https://example-deployment.convex.cloud',
  );
  assert.equal(convexDeploymentUrl('http://127.0.0.1:3210/'), 'http://127.0.0.1:3210');
});

test('rejects URL components that are not part of a deployment origin', () => {
  for (const value of [
    'https://example.convex.cloud/api/query',
    'https://example.convex.cloud/?token=nope',
    'https://example.convex.cloud/#fragment',
    'https://user:password@example.convex.cloud/',
  ]) {
    assert.throws(() => convexDeploymentUrl(value), /bare origin|must not contain credentials/);
  }
});
