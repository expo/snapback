import {
  useSnapbackMedia,
  useSnapbackQuery,
} from '@expo/snapback-react';
import type { MediaRef } from '@expo/snapback-client/assets';

import api, { type FunctionArgs } from './generated/api';

const profiles = useSnapbackQuery(api.listProfiles, {});

if (profiles.status === 'ready' || profiles.status === 'refreshing') {
  const profile = profiles.data[0];
  if (profile) {
    // LLP 0244's projected field flows directly into the public media hook.
    useSnapbackMedia(profile.image);
    const featured: MediaRef<'image' | 'video'> = profile.featured;
    useSnapbackMedia(featured);

    // A principal projected from a document result round-trips into a
    // Principal-branded generated operation argument.
    const inviteArgs = { userId: profile.ownerId } satisfies FunctionArgs<typeof api.inviteMember>;
    void inviteArgs;
  }
}
