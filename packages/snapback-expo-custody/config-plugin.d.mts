export type ExpoConfig = Record<string, unknown>;

export interface SnapbackExpoCustodyConfigPlugin {
  (config: ExpoConfig): ExpoConfig;
  readonly withSnapbackExpoCustody: SnapbackExpoCustodyConfigPlugin;
  readonly SNAPBACK_AUTH_CUSTODY_BACKUP_RULES:
    '@xml/snapback_auth_custody_backup_rules';
  readonly SNAPBACK_AUTH_CUSTODY_DATA_EXTRACTION_RULES:
    '@xml/snapback_auth_custody_data_extraction_rules';
}

export const SNAPBACK_AUTH_CUSTODY_BACKUP_RULES:
  '@xml/snapback_auth_custody_backup_rules';
export const SNAPBACK_AUTH_CUSTODY_DATA_EXTRACTION_RULES:
  '@xml/snapback_auth_custody_data_extraction_rules';
export function applyAndroidCustodyBackupAttributes(
  mainApplication: Record<string, unknown>,
): Record<string, unknown>;
export const withSnapbackExpoCustody: SnapbackExpoCustodyConfigPlugin;
declare const plugin: SnapbackExpoCustodyConfigPlugin;
export default plugin;
export { plugin as 'module.exports' };
