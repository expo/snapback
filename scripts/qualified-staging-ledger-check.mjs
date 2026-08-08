// Closure check for the qualified-staging assemble job. Lives as a file so
// the EAS workflow YAML stays under the 16 KiB revision cap; the workflow
// calls it with SNAPBACK_PACKAGE_OUT, SOURCE_REVISION, and CANDIDATE_TAG set.
import fs from 'node:fs';
import { PACKAGE_INVENTORY } from './snapback-publish-core.mjs';

const ledger = JSON.parse(fs.readFileSync(
  `${process.env.SNAPBACK_PACKAGE_OUT}/publish-ledger.json`,
  'utf8',
));
if (ledger.schemaVersion !== 'snapback.package-qualified-staging-ledger.v1'
    || ledger.mode !== 'dry-run'
    || ledger.sourceDirty !== false
    || ledger.revision !== process.env.SOURCE_REVISION
    || ledger.tag !== process.env.CANDIDATE_TAG
    || ledger.packages.length !== PACKAGE_INVENTORY.length) {
  throw new Error('qualified staging ledger did not close');
}
