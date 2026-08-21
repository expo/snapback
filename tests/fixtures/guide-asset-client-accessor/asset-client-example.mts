import {
  SnapbackClient,
  createAssetClient,
} from '@expo/snapback-client';
import { defaults } from './snapback/generated/api.mjs';

export function startAvatarUpload(client: SnapbackClient, file: Blob) {
  return createAssetClient(client).start({
    upload: defaults.profiles.avatar,
    file,
  });
}
