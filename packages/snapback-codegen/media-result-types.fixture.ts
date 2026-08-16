import {
  useSnapbackMedia,
  useSnapbackQuery,
} from '@expo/snapback-react';

import api from './generated/api';

const profiles = useSnapbackQuery(api.listProfiles, {});

if (profiles.status === 'ready' || profiles.status === 'refreshing') {
  const profile = profiles.data[0];
  if (profile) {
    // LLP 0244's projected field flows directly into the public media hook.
    useSnapbackMedia(profile.image);
  }
}
