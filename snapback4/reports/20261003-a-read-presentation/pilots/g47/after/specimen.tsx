import {readPresentation} from 'snapback4/contract';
import {useQuery} from 'snapback4/react';
import {api} from './snapback/generated/api';
import {ReadNotice} from './src/ReadNotice';
function EnsureProfile({ children }: { children: React.ReactNode }) {
  const status = readPresentation(useQuery(api.myProfile, {}));
  return <>{children}<ReadNotice status={status} /></>;
}
