// Root-only compatibility composition. Keeping this selection in its own
// static module gives metrology a literal positive/negative boundary while
// all state continues to live in implementation.mjs's single provider owner.
// @ref LLP 0179#no-second-owner — surfaces compose canonical child owners.
// @ref LLP 0180#react-and-surface-projections — commands retain their stable
// synchronous task projection on the full compatibility entry.
import { createCommandClient } from '@expo/snapback-client';
import { createAssetClient } from '@expo/snapback-client/assets';
import {
  assetRegistries,
  commandClients,
} from './implementation.mjs';

assetRegistries.f = createAssetClient;
commandClients.f = createCommandClient;

export {
  SnapbackAssetImage,
  SnapbackFullProvider as SnapbackProvider,
  bindSnapbackSurface,
  createSnapbackReactFullProvider as createSnapbackReactProvider,
  invokeSnapbackCommand,
  observeSnapbackSurface,
  useSnapbackAssetImage,
  useSnapbackAssetUpload,
  useSnapbackAssetUrl,
  useSnapbackMedia,
  useSnapbackMediaCollection,
  useSnapbackCommand,
  useSurface,
} from './implementation.mjs';

export {
  placeholderToDataURL,
  rgbaToDataURL,
  thumbHashToApproximateAspectRatio,
  thumbHashToDataURL,
  thumbHashToRGBA,
} from './thumbhash.mjs';
