'use strict';

const packageManifest = require('./package.json');

const BACKUP_RULES = '@xml/snapback_auth_custody_backup_rules';
const DATA_EXTRACTION_RULES = '@xml/snapback_auth_custody_data_extraction_rules';

function configError(attribute, actual, required) {
  const error = new Error(
    `SNAPBACK_AUTH_CUSTODY_BACKUP_RULES_CONFLICT: Android ${attribute} already names ${actual}; native custody requires ${required}`,
  );
  error.code = 'SNAPBACK_AUTH_CUSTODY_BACKUP_RULES_CONFLICT';
  error.diagnostic = Object.freeze({
    code: error.code,
    message: 'Android backup rules must exclude Snapback native custody files.',
    details: Object.freeze({ attribute, actual, required }),
  });
  return error;
}

// Exported for deterministic unit tests without loading Expo's config-plugin
// runtime in this JS-only monorepo checkout.
function applyAndroidCustodyBackupAttributes(mainApplication) {
  if (!mainApplication || typeof mainApplication !== 'object') {
    throw new TypeError('mainApplication must be an Android manifest application object');
  }
  if (!mainApplication.$ || typeof mainApplication.$ !== 'object') mainApplication.$ = {};
  for (const [attribute, required] of [
    ['android:fullBackupContent', BACKUP_RULES],
    ['android:dataExtractionRules', DATA_EXTRACTION_RULES],
  ]) {
    const actual = mainApplication.$[attribute];
    if (actual !== undefined && actual !== required) {
      throw configError(attribute, actual, required);
    }
    mainApplication.$[attribute] = required;
  }
  return mainApplication;
}

function withSnapbackExpoCustody(config) {
  const {
    AndroidConfig,
    createRunOncePlugin,
    withAndroidManifest,
  } = require('expo/config-plugins');

  const withBackupExclusions = (input) => withAndroidManifest(input, (next) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(next.modResults);
    // @ref LLP 0263#22-key-material-and-backup-rules — ciphertext cannot outlive its non-exportable Keystore key, so both cloud backup and device transfer exclude the dedicated custody directory.
    applyAndroidCustodyBackupAttributes(mainApplication);
    return next;
  });

  return createRunOncePlugin(
    withBackupExclusions,
    packageManifest.name,
    packageManifest.version,
  )(config);
}

module.exports = withSnapbackExpoCustody;
module.exports.withSnapbackExpoCustody = withSnapbackExpoCustody;
module.exports.applyAndroidCustodyBackupAttributes = applyAndroidCustodyBackupAttributes;
module.exports.SNAPBACK_AUTH_CUSTODY_BACKUP_RULES = BACKUP_RULES;
module.exports.SNAPBACK_AUTH_CUSTODY_DATA_EXTRACTION_RULES = DATA_EXTRACTION_RULES;
