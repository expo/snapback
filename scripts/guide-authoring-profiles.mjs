import { createHash } from 'node:crypto';

import {
  FROZEN_LEGACY_AUTHORING_PROFILE_ROWS,
  MIGRATED_LEGACY_AUTHORING_PROFILE_PATHS,
} from './guide-authoring-profiles-baseline.mjs';

export const AUTHORING_PROFILE_EXPLICIT = 'explicit';
export const AUTHORING_PROFILE_FAMILIAR = 'familiar';

const PROFILE_SCOPE_BY_LABEL = new Map([
  ['neutral', []],
  ['explicit', [AUTHORING_PROFILE_EXPLICIT]],
  ['familiar', [AUTHORING_PROFILE_FAMILIAR]],
  ['explicit+familiar', [AUTHORING_PROFILE_EXPLICIT, AUTHORING_PROFILE_FAMILIAR]],
]);

// Active remainder of the 2026-08-28 survey. The immutable 99-tuple authority
// lives in guide-authoring-profiles-baseline.mjs; every row here must match it
// exactly, and this list may change only by deleting a migrated page's row.
// Generated guide/reference/ pages are governed by their generator and remain
// outside this authored-page migration inventory.
export const LEGACY_AUTHORING_PROFILE_ROWS = Object.freeze([
  ['guide/auth/agent-principals.md', 'neutral', 'ec59adc9149ba2321b2047f394e4b47e417829953a0d015b37d56bbbb54a2fd1'],
  ['guide/auth/logical-transfer.md', 'neutral', '51db89e637cf280b4bfcb23af92d9e4efdf166c9787edde633d8e0e9fa327877'],
  ['guide/auth/native-apps.md', 'neutral', 'de0e0e69f04289bd38cd1c1d9438fa0fc57bc9f72d79fa42318782575f8ffb3c'],
  ['guide/auth/protecting-data.md', 'explicit', '79925b23c07b7f96c7676ab72f2a123db7fabcf76b4a52011f1d1e268936a9cc'],
  ['guide/auth/sessions-and-principals.md', 'explicit', '3b58f34cde6b3b9c2fb2f52cd5c76efbe8a6c4e226264379823a20de05f3e140'],
  ['guide/auth/targets.md', 'neutral', '455427f4807718c9a02580677d531757b3b6c3e020089cf1bbf82a116c5d0a66'],
  ['guide/backend/actions-and-fetch.md', 'explicit', '84a9b68d76089f7cffffffab1d7d4b8712af9082a7e30ee2b0a382acfbea7269'],
  ['guide/backend/assets.md', 'explicit+familiar', '40a94a3b350c131877e17b57598ff0697e0bec8f04b84d414f65b48938c48acc'],
  ['guide/backend/declarative-plans.md', 'explicit', '2494e1fc23fafcff1346ae95bdfcf1c00b9bd3a98ed73187dfc6699584c64ff9'],
  ['guide/backend/expo-push.md', 'explicit', 'b9ce07d7c673c9878a5492a6fbb47ecf9024a21b8a277c5fb3601d745bad03ac'],
  ['guide/backend/external-api.md', 'explicit', '3c5ea0c742f3c7410fa9360b08cf333bccfcbf9cb3c2c7cd94aca94d44e6f4f9'],
  ['guide/backend/handler-runtime.md', 'explicit', '3eabb4ad82e2bb97d2b1e4bf7c3533ae9822e56e1c78d6f40b59a61c204ff4ba'],
  ['guide/backend/jobs.md', 'explicit', '40ff787cba152c7803c294998d5070ceb6e313ea5b821ac2d549d0281f65abd8'],
  ['guide/backend/migrations.md', 'explicit', 'b84eb4cfa9cd74bf871c4aa00e99a645d098cdec3fb3fd2f321601e0e6a25456'],
  ['guide/backend/query-costs.md', 'neutral', '9d61cc4b6e80b6c2c0add0a5061d978836b57f40896d66c6b8f2c829da1a7fb9'],
  ['guide/backend/relational-queries.md', 'explicit', '6662078ce8301ef809ddb29d9f3e9979e0cc67228f65a07b3fd61b9cfc934448'],
  ['guide/backend/sequences.md', 'explicit', 'c27541fc684ecdb1c843c45f93bb9ff876c2c8de7df5bf2eb6fe43063fc9377e'],
  ['guide/backend/snapshot-batches.md', 'explicit', '3309606a532d258148f9a54e300b460cf24fb9807de498ac0defaa037c4b3730'],
  ['guide/backend/standard-patterns.md', 'explicit', '8c2dd44abddb1ff2b96442948bbd0a1240b26e096e5cfed8de9db30799a011c3'],
  ['guide/backend/streamed-actions.md', 'explicit', '13f430b8a4f2d45a78b7ac364702d8254ab462f82786387cfa4be86195421da7'],
  ['guide/backend/text-search.md', 'explicit', '7b16e33597cc34d4a64cf43914eaff2873be907cd40fd196326c8509d30bd8ac'],
  ['guide/backend/trusted-runtime-values.md', 'explicit', 'b6e8a439b0dc69ff4a2421959c35485f625e60c5550f536c41a2961969071443'],
  ['guide/backend/vector-search.md', 'explicit', 'f5ab69bb87241723f43253f05dc0ea5156e1e83b4235927bc87a055cf933b54e'],
  ['guide/backend/versioned-seeds.md', 'explicit', '9653f88727e2e95b8b1e26c6ec27d9576bca63168c256ef1d6b2df101647f33c'],
  ['guide/clients/app-cli.md', 'neutral', 'dd8fa72ff47067d0af87ef004061282bdf885603713e9fc3fa1d098e859f4f73'],
  ['guide/clients/contract-adapter.md', 'neutral', '0c63ba1c19f15b45616907d124b698c5422982099bad5c9c86f5273be4972e84'],
  ['guide/clients/framework-bindings.md', 'neutral', '672a3e7c97f260ab4d8047014f6f854ac0b502e4bef1aa6296ba53876dbd4e8f'],
  ['guide/clients/headless.md', 'neutral', '90e63bd7107200a0af80121773fba452bdba549bcf4c8a1acbe4c944a990e64b'],
  ['guide/clients/surfaces.md', 'explicit', 'f5bbc824cd3a32ab65dbe4bbcc115ef3fdb0ef84d6f3c1434766684359fdfabb'],
  ['guide/clients/swift.md', 'neutral', 'a95f73e9cb8c5e84fcdad6796d6bdf4de80a3b39bf15f87973ced3e196ca941b'],
  ['guide/deploying/cloudflare.md', 'neutral', '66f5535ba643915d5a3457445aec13db50ce48847e72adc0b11018e33272990b'],
  ['guide/deploying/releases.md', 'neutral', '4d38c4f6eeb76f3219c39c121d87bbc6ef754ac44317766c542a88134f355ca2'],
  ['guide/getting-started/generated-artifacts.md', 'explicit+familiar', '71e99f37d85dbc8f1af403b82808bbd91dffa48fcb57aec95eec5e776917f43a'],
  ['guide/getting-started/the-authoring-loop.md', 'explicit', '49c84ecb6efa53d323d10b79f387de644a0a11a7c216dd45e614dc45d93d7c3b'],
  ['guide/operating/admin-console.md', 'neutral', '52771a40661bc70a0c244815d07dd97fc914ef2926ba0df89307f34a8f474b94'],
  ['guide/operating/agent-controls.md', 'neutral', '169ce64fb1a81363f8add549721191dceda9851103a6a1c35f554db3135ea61f'],
  ['guide/operating/backup-and-copy.md', 'neutral', 'adb895ed57fac91c714cd7ffd46fb110c3efe92ca16230b307972ea638d127d7'],
  ['guide/operating/data-patch.md', 'neutral', 'b69838b20b6feaefc4cc52e174a046c6158e4eef98655a9108953e9c5ea25cdf'],
  ['guide/operating/error-tracking.md', 'neutral', '7268c2e745caae95a7abcf7e33a54004922750823c90c88ac6a560c288fc9173'],
  ['guide/operating/host-ops.md', 'neutral', '37a3fd6d076c493442658c8268a324789279a88ff9ea6d029dfad93025cdcbaf'],
  ['guide/operating/instance-forks.md', 'neutral', '81420596bc9b52889c784256d8f3a42301f6048cbc6605d90e48ac87b342295c'],
  ['guide/operating/network-profiles.md', 'neutral', '85b87ebb3e08a650683b4f9e4a8a028d5c1b9cdefd17630eb1e6f109bf34cb7a'],
  ['guide/operating/observability.md', 'neutral', 'c539361d85e5fd52d259e0c93fd0511e072e92b119dbd3f5371d2ecd99d216a8'],
  ['guide/operating/replication.md', 'neutral', '52031b218ec50c6be2b27b7a9b94d272f8bab5f6c8a8897260b5535cbfd76ebc'],
  ['guide/operating/secrets-and-config.md', 'explicit', 'dc2b364534ca7dce6ef7fa5891a88646ea7162590ffeb751a7cb701c4fa5277a'],
  ['guide/protocol/client-protocol.md', 'neutral', 'b64705e1d4dcb141a226959bca829e9f624010a7cab2ebe87fefddef5378b1bf'],
  ['guide/realtime/ephemeral-state.md', 'explicit', '512db06bc6132e1b93a952a7b6e2f739463fd6732ced0d3d09d25d92c6f0a0c1'],
  ['guide/realtime/snapshot-bundles.md', 'explicit', 'a8389442c6be4b93ed4e03920d224593381e41fd15f9afef663c0a6f0e089eed'],
  ['guide/recipes/activity-presence.md', 'neutral', '8db63728842f5fdbb5979cb540bbb38a9fee8cce818c680ced2c65a7a8e3baf0'],
  ['guide/recipes/browser-auth.md', 'explicit', '851b92fb4f485cfae53f1231478d831f48d18f2029a46118f4db25621eb9377a'],
  ['guide/recipes/capability-links.md', 'explicit', '3e066b88609cabb75aca1e17035fcfb8de428a360eed5d001ce75741811f0299'],
  ['guide/recipes/chunked-semijoin-feed.md', 'explicit', 'ad256c3ca81d1684dc19fac1cb5b5bc97bb87178af1f144e0f126c8391fde299'],
  ['guide/recipes/coming-from-convex-and-supabase.md', 'explicit', '5017455fd4e41b45709ccbf63c70ff8763171025057f062101e15ebdbe36acec'],
  ['guide/recipes/fixed-origin-development.md', 'neutral', '8366dfb7c6f4b6e4afa9f8db5ee26690a6e29004a8bd93fdd8a8b20c735b6015'],
  ['guide/recipes/hidden-hands.md', 'explicit', 'eac126e79fe659b66be436dcabeca25d6bfd15fa2afaaee7c478fca022c7b633'],
  ['guide/recipes/membership-roster-projection.md', 'explicit+familiar', '97e07da983932cedfe201be11cba6c7fa71b6b1419b81ffdb786d2ae71c0ec5a'],
  ['guide/recipes/multi-persona-clients.md', 'neutral', '13e3d5012dcb47b257d82416b4d2a4eaf5a039e71dd23e1eb8c827507533c94b'],
  ['guide/recipes/optimistic-toggle.md', 'neutral', '525f87057e7dfc021bd032a66f0d06cb07aeae0ee61830904d112ddd60fe55dc'],
  ['guide/recipes/paged-list.md', 'explicit', '395e6897514187ced29dae3a3bacb864fbd6baf9789602de3b8eb9ccdbe2fbbf'],
  ['guide/recipes/presence-cursors.md', 'explicit', '7bb85ab2a8386690894b21930a4ab0b4a08a525216c43a827796bb3bb9b76e75'],
  ['guide/recipes/provider-lifecycle.md', 'neutral', '9890dbb5b2d67a6875e4fbb00c7a7601a3d9681bb441e2c264d3bf918ed4bb6c'],
  ['guide/recipes/sessions-fixture-install.md', 'neutral', '305df120b50dfc0b49d5b67e2f98b7adb0aa88fac43cf129b52fd68b5a0842ca'],
  ['guide/recipes/time-windowed-live-reads.md', 'explicit', 'c689a41ce97e0dbf6cd2e8a8134efa273dabf7efe96df400537bba46923b4ad8'],
  ['guide/recipes/typing-indicators.md', 'explicit', '9b949661fffe294b908e40152b00b6a514b023534ceb2e4eb44d392994a845a3'],
  ['guide/start/crud-dashboard.md', 'explicit', '94c7d8b478a73be3d928e30d7c096f41bb226ed6329b395500e3c773d9af098f'],
  ['guide/start/media-feed.md', 'explicit', 'bed368c0e91dc2eaadc8cf9f89683be7b1360a9532b23120b10b8207802b2183'],
  ['guide/start/mental-model.md', 'explicit', '46a3e0227bef13f4a281189fb663a324de10f45b29db88e0daa62310244517c3'],
  ['guide/start/react.md', 'explicit', '4a9ef07486f446e5eb92c29fe69690fc63c6bf3d99fafb817cfcd2127d927eba'],
  ['guide/start/todo-contract.md', 'explicit', 'a8935d4e591a5486c9691f4cf8254ae615b781b0e0fedf6b3779004264ad9821'],
  ['guide/surface-map.md', 'neutral', '01b648d800fbbc6629ab1d63ea9df6d3ecbdd840633becbc2c9e178463542307'],
  ['guide/testing/acceptance.md', 'neutral', '304c727d1eedc6c632fbf254b6b835c25995f1bacf7c4b05ed573e9029cae455'],
  ['guide/testing/large-fixtures.md', 'explicit', '5feb6d679665f949149b12a6277ca7ec10d47154b787a45772728d6a1c0f633f'],
  ['guide/testing/verify.md', 'neutral', '1a1e0eaebcc94fadd095e93ccc859f2362ad9d731045bef4a73acae4ac2f8813'],
].map((row) => Object.freeze(row)));

const FROZEN_LEGACY_AUTHORING_PROFILE_INVENTORY = new Map(
  FROZEN_LEGACY_AUTHORING_PROFILE_ROWS.map(([path, label, sha256]) => [
    path,
    { label, sha256 },
  ]),
);
const MIGRATED_LEGACY_AUTHORING_PROFILE_PATH_SET = new Set(
  MIGRATED_LEGACY_AUTHORING_PROFILE_PATHS,
);

export const LEGACY_AUTHORING_PROFILE_INVENTORY = new Map(
  LEGACY_AUTHORING_PROFILE_ROWS.map(([path, label, sha256]) => [
    path,
    { authoringProfiles: PROFILE_SCOPE_BY_LABEL.get(label), sha256 },
  ]),
);

function legacyAuthoringProfileInventory(rows) {
  return new Map(rows.map(([path, label, sha256]) => [
    path,
    { authoringProfiles: PROFILE_SCOPE_BY_LABEL.get(label), sha256 },
  ]));
}

export function validateLegacyAuthoringProfileRows(rows, errors) {
  if (
    FROZEN_LEGACY_AUTHORING_PROFILE_INVENTORY.size
      !== FROZEN_LEGACY_AUTHORING_PROFILE_ROWS.length
  ) {
    errors.push('frozen legacy authoring-profile authority contains a duplicate path');
  }
  if (
    MIGRATED_LEGACY_AUTHORING_PROFILE_PATH_SET.size
      !== MIGRATED_LEGACY_AUTHORING_PROFILE_PATHS.length
  ) {
    errors.push('legacy authoring-profile migration ledger contains a duplicate path');
  }
  for (const path of MIGRATED_LEGACY_AUTHORING_PROFILE_PATHS) {
    if (!FROZEN_LEGACY_AUTHORING_PROFILE_INVENTORY.has(path)) {
      errors.push(`${path}: legacy authoring-profile migration ledger path is outside the frozen survey`);
    }
  }

  const seenPaths = new Set();
  for (const [path, label, sha256] of rows) {
    if (seenPaths.has(path)) {
      errors.push(`${path}: legacy authoring-profile inventory contains a duplicate path`);
      continue;
    }
    seenPaths.add(path);

    const frozen = FROZEN_LEGACY_AUTHORING_PROFILE_INVENTORY.get(path);
    if (!frozen) {
      errors.push(
        `${path}: legacy authoring-profile inventory row was added outside the frozen survey; `
          + `new exemptions are forbidden. Repair: declare 'authoring-profiles' on the page `
          + 'and remove the added row',
      );
      continue;
    }
    if (MIGRATED_LEGACY_AUTHORING_PROFILE_PATH_SET.has(path)) {
      errors.push(
        `${path}: legacy authoring-profile inventory row was restored after migration; `
          + `the inventory may only shrink. Repair: keep the page's 'authoring-profiles' `
          + 'declaration and remove the restored row',
      );
      continue;
    }
    if (label !== frozen.label) {
      errors.push(
        `${path}: legacy authoring-profile inventory scope changed from '${frozen.label}' `
          + `to '${label}'. Repair: declare 'authoring-profiles' with the intended scope `
          + 'on the page and remove its inventory row',
      );
    }
    if (sha256 !== frozen.sha256) {
      errors.push(
        `${path}: legacy authoring-profile inventory digest changed from `
          + `${frozen.sha256.slice(0, 12)}… to ${String(sha256).slice(0, 12)}…; `
          + `edit-and-rehash exemptions are forbidden. Repair: declare 'authoring-profiles' `
          + 'on the page and remove its inventory row; never refresh the digest in place',
      );
    }
    if (!/^[0-9a-f]{64}$/u.test(sha256)) {
      errors.push(`${path}: legacy authoring-profile inventory has an invalid SHA-256`);
    }
  }

  for (const path of FROZEN_LEGACY_AUTHORING_PROFILE_INVENTORY.keys()) {
    if (!seenPaths.has(path) && !MIGRATED_LEGACY_AUTHORING_PROFILE_PATH_SET.has(path)) {
      errors.push(
        `${path}: frozen legacy authoring-profile row disappeared without a recorded migration. `
          + `Repair: declare 'authoring-profiles' on the page, keep its exact row deleted, `
          + 'and add its path to MIGRATED_LEGACY_AUTHORING_PROFILE_PATHS',
      );
    }
  }
}

function rawSha256(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

function isGeneratedReferencePage(path) {
  return path.startsWith('guide/reference/');
}

function generatedReferenceScope(path) {
  return path === 'guide/reference/expo-snapback-react--familiar.md'
    ? [AUTHORING_PROFILE_FAMILIAR]
    : [];
}

export function resolveAuthoringProfileScopes(
  pageInfo,
  errors,
  { legacyRows = LEGACY_AUTHORING_PROFILE_ROWS } = {},
) {
  validateLegacyAuthoringProfileRows(legacyRows, errors);
  const legacyInventory = legacyRows === LEGACY_AUTHORING_PROFILE_ROWS
    ? LEGACY_AUTHORING_PROFILE_INVENTORY
    : legacyAuthoringProfileInventory(legacyRows);

  for (const [path, info] of pageInfo) {
    if (isGeneratedReferencePage(path)) {
      info.authoringProfiles = generatedReferenceScope(path);
      continue;
    }

    const declared = info.frontmatter?.['authoring-profiles'];
    const legacy = legacyInventory.get(path);
    const frozen = FROZEN_LEGACY_AUTHORING_PROFILE_INVENTORY.get(path);
    if (declared !== undefined) {
      info.authoringProfiles = declared;
      if (legacy) {
        errors.push(
          `${path}: declares 'authoring-profiles'; remove its legacy authoring-profile inventory row`,
        );
      }
      continue;
    }

    if (!legacy || !frozen) {
      errors.push(
        `${path}: frontmatter missing required field 'authoring-profiles' `
          + '(new and changed authored pages may not enter the legacy inventory)',
      );
      continue;
    }

    const actual = rawSha256(info.raw);
    if (actual !== frozen.sha256) {
      errors.push(
        `${path}: content changed from legacy authoring-profile baseline ${frozen.sha256.slice(0, 12)}… `
          + `(current ${actual.slice(0, 12)}…); declare 'authoring-profiles' and remove its inventory row`,
      );
      continue;
    }
    info.authoringProfiles = PROFILE_SCOPE_BY_LABEL.get(frozen.label);
  }

  for (const path of legacyInventory.keys()) {
    if (!pageInfo.has(path)) {
      errors.push(`${path}: stale legacy authoring-profile inventory row for a missing page`);
    }
  }
}
