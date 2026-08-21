import { Redirect } from 'expo-router';
import { useSnapbackQuery } from '@knockoff/snapback-react';

import { QueryState } from '@/components/query-state';
import { api } from '@/lib/snapback';

export default function MyProfile() {
  const query = useSnapbackQuery(api.viewerProfile, {});
  if (query.status !== 'ready' && query.status !== 'refreshing') {
    return <QueryState message="Opening your profile…" error={query.status === 'error' ? query.error : undefined} />;
  }
  const profile = query.data[0];
  if (!profile) return <QueryState message="Finishing your profile…" />;
  return <Redirect href={{ pathname: '/profile/[handle]', params: { handle: profile.handle } }} />;
}
