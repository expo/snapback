// RV-XTP: export-types declaration parity on the three 3c2b478b subpaths,
// consumed from the public 0.1.8 closure.
import { thumbHashToDataURL, placeholderToDataURL } from '@expo/snapback-react/thumbhash';
import { createAssetClient, __testIncrementalSha256 } from '@expo/snapback-client/assets';
import {
  SEED_ASSET_FIXTURES_FORMAT_V1,
  buildSeedAssetFixturesV1,
  canonicalSeedAssetFixturesJson,
  seedAssetFixturesDigest,
  type SeedAssetFixturesV1,
} from '@expo/snapback-codegen/seed-artifact';

const format: 'snapback.seed-asset-fixtures.v1' = SEED_ASSET_FIXTURES_FORMAT_V1;
const usable: unknown[] = [
  thumbHashToDataURL,
  placeholderToDataURL,
  createAssetClient,
  __testIncrementalSha256,
  buildSeedAssetFixturesV1,
  canonicalSeedAssetFixturesJson,
  seedAssetFixturesDigest,
  format,
];
export type Probe = SeedAssetFixturesV1;
export const ok = usable.every((entry) => entry !== undefined);
