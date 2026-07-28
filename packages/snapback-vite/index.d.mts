export type SnapbackViteLifecycleMode =
  | 'off'
  | 'external'
  | 'attach'
  | 'managed'
  | 'auto';

export interface SnapbackDevOptions {
  route?: string;
  projectRoot?: string;
  generatedRoots?: readonly string[];
  allowNonLoopbackHost?: boolean;
  server?: {
    mode?: SnapbackViteLifecycleMode;
    url?: string;
    readyFile?: string;
    database?: string;
    backendDirectory?: string;
  };
  onDiagnostic?: (diagnostic: Readonly<Record<string, unknown>>) => void;
}

// Deliberately structural: @snapback/vite supports multiple Vite majors and
// must not leak the package build's peer copy into an application's config
// type graph.
export function snapbackDev(options?: SnapbackDevOptions): {
  readonly name: 'snapback-dev';
  readonly [hook: string]: any;
};

export const VIRTUAL_MODULE_ID: 'virtual:snapback/dev';
export const LIFECYCLE_MODES: readonly SnapbackViteLifecycleMode[];

export function resolveGeneratedImport(id: string, importer: string): string | null;
export function renderVirtualModule(input: {
  base: string;
  state?: Readonly<Record<string, unknown>>;
}): string;
