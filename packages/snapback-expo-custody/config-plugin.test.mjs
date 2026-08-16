import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  SNAPBACK_AUTH_CUSTODY_BACKUP_RULES,
  SNAPBACK_AUTH_CUSTODY_DATA_EXTRACTION_RULES,
  applyAndroidCustodyBackupAttributes,
} = require('./config-plugin.cjs');

test('config plugin installs mandatory legacy and API 31+ backup rule resources', () => {
  const application = { $: { 'android:name': '.MainApplication' } };
  assert.equal(applyAndroidCustodyBackupAttributes(application), application);
  assert.equal(
    application.$['android:fullBackupContent'],
    SNAPBACK_AUTH_CUSTODY_BACKUP_RULES,
  );
  assert.equal(
    application.$['android:dataExtractionRules'],
    SNAPBACK_AUTH_CUSTODY_DATA_EXTRACTION_RULES,
  );
  applyAndroidCustodyBackupAttributes(application);
});

test('config plugin refuses conflicting app backup rules instead of weakening exclusion', () => {
  assert.throws(
    () => applyAndroidCustodyBackupAttributes({
      $: { 'android:fullBackupContent': '@xml/application_backup_rules' },
    }),
    (error) => error?.code === 'SNAPBACK_AUTH_CUSTODY_BACKUP_RULES_CONFLICT',
  );
});

test('shipped extraction resources exclude custody from cloud backup and device transfer', async () => {
  const extraction = await readFile(
    new URL('./android/src/main/res/xml/snapback_auth_custody_data_extraction_rules.xml', import.meta.url),
    'utf8',
  );
  const legacy = await readFile(
    new URL('./android/src/main/res/xml/snapback_auth_custody_backup_rules.xml', import.meta.url),
    'utf8',
  );
  assert.match(extraction, /<cloud-backup>[\s\S]*<exclude domain="file" path="snapback-auth-custody\/" \/>[\s\S]*<\/cloud-backup>/u);
  assert.match(extraction, /<device-transfer>[\s\S]*<exclude domain="file" path="snapback-auth-custody\/" \/>[\s\S]*<\/device-transfer>/u);
  assert.match(legacy, /<full-backup-content>[\s\S]*<exclude domain="file" path="snapback-auth-custody\/" \/>[\s\S]*<\/full-backup-content>/u);
});
