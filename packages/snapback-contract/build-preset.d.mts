export interface SnapbackContractBuildDiagnostic {
  code: string;
  severity: 'error';
  subsystem: 'contract-integration';
  message: string;
  details: Record<string, unknown> & { target_surface: string };
}

export class SnapbackContractBuildError extends Error {
  constructor(diagnostic: SnapbackContractBuildDiagnostic);
  diagnostic: SnapbackContractBuildDiagnostic;
}

export function buildSnapbackContractStaticApp(options: {
  root: string;
  basePath?: string;
  entry?: string;
  outDir?: string;
  routeRegistry?: string;
  staticPlatformTargets?: readonly string[];
  logLevel?: string;
  rewriteBasePath?: boolean;
}): Promise<{
  root: string;
  exactSource: 'installed-packages';
  outDir: string;
  basePath: string;
  staticPlatformTargets: readonly string[];
}>;

/**
 * Give every outer build and nested prerender server its own immutable config
 * path; the callback owns the complete lifetime of the generated config file.
 */
export function withStaticBuildConfig<T>(
  options: {
    appRoot: string;
    exactModules: Readonly<Record<'vite' | 'exactVitePlugin' | 'contractVitePlugin', string>>;
    basePath: string;
    entry: string;
    routeRegistry: string;
    staticPlatformTargets: readonly string[] | false;
    outDir: string;
  },
  run: (configFilePath: string) => T | Promise<T>,
): Promise<T>;

export function contractViteBaseConfig(options: {
  root: string;
  entry?: string;
  routeRegistry?: string;
  exactPluginOptions?: Record<string, unknown>;
}): Promise<{
  root: string;
  exactSource: 'installed-packages';
  entry: string;
  routeRegistry: string;
  exactModules: Readonly<Record<'vite' | 'exactVitePlugin' | 'contractVitePlugin', string>>;
  config: {
    appType: 'custom';
    configFile: false;
    root: string;
    plugins: unknown[];
    resolve: { dedupe: string[] };
  };
}>;

export function serveSnapbackContractApp(options: {
  root: string;
  entry?: string;
  routeRegistry?: string;
  apiTarget?: string | null;
  apiProxyPath?: string;
  host?: string | null;
  port?: number | string | null;
  allowNonLoopbackHost?: boolean;
  logLevel?: string;
}): Promise<{
  server: unknown;
  root: string;
  exactSource: 'installed-packages';
  entry: string;
  apiTarget: string;
  apiTargetSource: 'explicit' | 'default-pinned-port';
  apiProxyPath: string;
  host: string;
  port: number;
}>;

export function rewriteStaticBasePath(options: { indexPath: string; basePath: string }): void;

export function snapbackContractBuildDiagnostic(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): SnapbackContractBuildDiagnostic;

export function resolveSnapbackContractDevServerOptions(options?: {
  apiTarget?: string | null;
  apiProxyPath?: string;
  host?: string | null;
  port?: number | string | null;
  allowNonLoopbackHost?: boolean;
}): {
  apiTarget: string;
  apiTargetSource: 'explicit' | 'default-pinned-port';
  apiProxyPath: string;
  host: string;
  hostIsLoopback: boolean;
  port: number;
  allowNonLoopbackHost: boolean;
};

export function createSnapbackAdminDevApiUnreachableDiagnostic(options?: {
  apiTarget?: string;
  requestPath?: string;
  error?: unknown;
}): SnapbackContractBuildDiagnostic;

export function createSnapbackWrongServerShapeDiagnostic(options?: {
  requestPath?: string;
}): SnapbackContractBuildDiagnostic;

/**
 * Dedupe entries are only safe when node resolution from the app root can
 * find the package (ENG-22600).
 */
export function resolveRootResolvableDedupe(
  appRoot: string,
  packageNames: readonly string[],
): string[];

/**
 * Resolve an installed package export from the app's node_modules hierarchy,
 * walking the installation key explicitly (alias-safe, ENG-22564).
 */
export function resolveInstalledPackageSpecifier(
  appRoot: string,
  specifier: string,
): string | null;
