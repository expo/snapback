export interface SnapbackExpoDevIdentityConfig {
  readonly platforms?: readonly ('ios' | 'android' | 'web')[];
  readonly ios?: Readonly<{ bundleIdentifier?: string }>;
  readonly android?: Readonly<{ package?: string }>;
  readonly [key: string]: unknown;
}

export declare function validateSnapbackExpoDevIdentityConfig<T extends SnapbackExpoDevIdentityConfig>(
  config: T,
): T;

export declare function withSnapbackExpoDevIdentity<T extends SnapbackExpoDevIdentityConfig>(
  config: T,
): T;

export interface SnapbackExpoDevIdentityConfigPlugin {
  <T extends SnapbackExpoDevIdentityConfig>(config: T): T;
  readonly withSnapbackExpoDevIdentity: typeof withSnapbackExpoDevIdentity;
  readonly validateSnapbackExpoDevIdentityConfig:
    typeof validateSnapbackExpoDevIdentityConfig;
}

declare const plugin: SnapbackExpoDevIdentityConfigPlugin;
export default plugin;
export { plugin as 'module.exports' };
