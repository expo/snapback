import { SnapbackClient } from '../../../../../packages/snapback-client/index.mjs';

declare const __SNAPBACK_API_ORIGIN__: string;

export const teamChatClient = new SnapbackClient(__SNAPBACK_API_ORIGIN__, {
  authClientProtocol: 1,
  authInvalidationProtocol: 1,
  custody: 'anonymous-public',
});

export async function queryTeamChat<Row>(
  reference: unknown,
  args: Record<string, unknown>,
  userId: string,
): Promise<{ rows: Row[]; cursor: string | null }> {
  const result = await teamChatClient.query(reference as never, { args, userId });
  return {
    rows: result.rows as Row[],
    cursor: typeof result.cursor === 'string' ? result.cursor : null,
  };
}
