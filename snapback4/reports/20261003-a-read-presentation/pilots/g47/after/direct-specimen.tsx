import {existence} from 'snapback4/contract';
import {useQuery} from 'snapback4/react';
import {api} from './snapback/generated/api';
import {ReadNotice} from './direct-notice';
function EnsureProfile({ children }: { children: React.ReactNode }) {
  const profile = useQuery(api.myProfile, {});
  return <>{children}<ReadNotice read={profile} /></>;
}
