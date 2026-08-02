import { SnapbackClient, parseSearchQueryV1 } from '@expo/snapback-client';
import { snapbackBasePath } from 'virtual:snapback/dev';
import api from '../snapback/generated/api.mjs';

export const client = new SnapbackClient(snapbackBasePath);
export const currentUser = { id: 'user_ada', name: 'Ada' } as const;
export { api, parseSearchQueryV1 };
