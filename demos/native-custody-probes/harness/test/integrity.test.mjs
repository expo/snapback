import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { iosAppBundleIdentity } from '../lib/integrity.mjs';

const plist = (bundleId) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${bundleId}</string></dict></plist>
`;

test('iOS artifact identity hashes the canonical full bundle inventory and reads Info.plist', () => {
  const root = mkdtempSync(join(tmpdir(), 'custody-app-bundle-'));
  const app = join(root, 'Probe.app');
  mkdirSync(join(app, 'Frameworks', 'Nested.framework'), { recursive: true });
  writeFileSync(join(app, 'Info.plist'), plist('dev.snapback.actual-bundle'));
  writeFileSync(join(app, 'Probe'), 'main executable');
  writeFileSync(join(app, 'Frameworks', 'Nested.framework', 'Nested'), 'framework bytes');

  const first = iosAppBundleIdentity(app);
  assert.equal(first.bundleId, 'dev.snapback.actual-bundle');
  assert.equal(first.inventoryFormat, 'snapback.ios-app-bundle-inventory.v1');
  assert.equal(first.fileCount, 3);

  writeFileSync(join(app, 'Frameworks', 'Nested.framework', 'Nested'), 'changed framework bytes');
  const second = iosAppBundleIdentity(app);
  assert.notEqual(second.sha256, first.sha256, 'nested bundle changes rotate the artifact hash');
});
