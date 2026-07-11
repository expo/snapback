/**
 * Registry-package fallback for the source-only Exact app bootstrap seam.
 *
 * Candidate Exact checkouts expose the native agent bootstrap from their app
 * source tree and vite.config.ts aliases this module id there. The currently
 * published packages do not expose that app-level seam, so ordinary registry
 * builds preserve the pre-existing agent-off behavior and fail visibly only
 * when a caller explicitly requests native agent boot.
 */
export async function ensureAppAgentBootstrap(): Promise<void> {
  const exactGlobal = globalThis as typeof globalThis & {
    __exactAgentBootstrap?: { boot?: boolean; enabled?: boolean };
    process?: { env?: Record<string, string | undefined> };
  };
  const requested =
    exactGlobal.__exactAgentBootstrap?.boot === true ||
    exactGlobal.__exactAgentBootstrap?.enabled === true ||
    exactGlobal.process?.env?.EXACT_AGENT_BOOT === '1';
  if (requested) {
    throw new Error(
      'native agent boot requires EXACT_ALL_ABOARD_SOURCE_ROOT until the app bootstrap seam is published',
    );
  }
}
