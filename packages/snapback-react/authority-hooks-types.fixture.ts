import api from '../../demos/team-chat/snapback/generated/api';
import type {
  AuthorityRosterPageV1,
  Id,
  Principal,
} from '../../demos/team-chat/snapback/generated/api';
import {
  useSnapbackAuthorityMutation,
  useSnapbackAuthorityMutationStatus,
  useSnapbackAuthorityMyRole,
  useSnapbackAuthorityRoster,
} from './core.mjs';

declare const roomId: Id<'roomsV2'>;
declare const principal: Principal;

const roster = useSnapbackAuthorityRoster(api.roomMembersV2, roomId, { limit: 25 });
if (roster.status === 'ready' || roster.status === 'refreshing') {
  const row = roster.data[0];
  if (row !== undefined) {
    const role: 'admin' | 'member' | 'owner' | 'invited' = row.role;
    const generatedPage: AuthorityRosterPageV1<typeof row> = {
      rows: roster.data,
      cursor: roster.cursor,
    };
    void role;
    void generatedPage;
    // @ts-expect-error the generated authority role remains a closed union.
    const unsupportedRole: 'moderator' = row.role;
    void unsupportedRole;
  }
}

const myRole = useSnapbackAuthorityMyRole(api.roomMembersV2, roomId);
if ((myRole.status === 'ready' || myRole.status === 'refreshing') && myRole.data !== null) {
  const role: 'admin' | 'member' | 'owner' | 'invited' = myRole.data.role;
  const status: 'active' | 'invited' = myRole.data.status;
  void role;
  void status;
}

const changeRole = useSnapbackAuthorityMutation(api.roomMembersV2.changeRole);
changeRole({ scopeId: roomId, principal, role: 'admin' }).then((outcome) => {
  if (outcome.status === 'settled') {
    const result: null = outcome.result;
    outcome.authorityTransitions[0]?.declaration.toUpperCase();
    void result;
  } else {
    outcome.clientMutationId.toUpperCase();
  }
});
// @ts-expect-error the generated transition admits only non-owner target roles.
changeRole({ scopeId: roomId, principal, role: 'owner' });
// @ts-expect-error generated scope identity remains table-specific.
useSnapbackAuthorityRoster(api.roomMembersV2, '' as Id<'rooms'>);

const disposition = useSnapbackAuthorityMutationStatus('queued-authority-1');
if (disposition.status === 'settled') {
  disposition.settlement.authorityTransitions[0]?.subject.toUpperCase();
} else if (disposition.status === 'failed') {
  disposition.failure.code.toUpperCase();
}
