export type ExpoConfig = Record<string, unknown> & {
  _internal?: { projectRoot?: string };
  extra?: Record<string, unknown>;
};

export interface SnapbackExpoConfigPlugin {
  (
    config: ExpoConfig,
    options?: { descriptor?: string; projectRoot?: string },
  ): ExpoConfig;
  readonly SNAPBACK_EXPO_INTEGRATION_RECEIPT_FORMAT:
    'snapback.expo-integration-receipt.v1';
  readonly withSnapbackExpo: SnapbackExpoConfigPlugin;
}

export const SNAPBACK_EXPO_INTEGRATION_RECEIPT_FORMAT:
  'snapback.expo-integration-receipt.v1';
export const withSnapbackExpo: SnapbackExpoConfigPlugin;
declare const plugin: SnapbackExpoConfigPlugin;
export default plugin;
export { plugin as 'module.exports' };
