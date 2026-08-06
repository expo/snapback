import {
  createSnapbackExpoBoot,
  type AppBindingV1,
  type AppDescriptorV1Like,
  type ExpoBootState,
  type SnapbackExpoEnvironmentV1,
} from './index.mjs';
import type { GeneratedAppDescriptorV1 } from '../../demos/zero-bakeoff/apps/field-notebook/snapback/generated/app.d.ts';

declare const app: AppDescriptorV1Like;
declare const environment: SnapbackExpoEnvironmentV1;
declare const generatedApp: GeneratedAppDescriptorV1;

const binding = {
  format: 'snapback.app-binding.v1',
  source: 'supervised-dev',
  descriptorIdentity: 'sha256:descriptor',
  target: {
    app: 'app',
    schema: 'sha256:schema',
    functions: 'sha256:functions',
    origin: 'http://127.0.0.1:3000',
    routing: 'loopback',
  },
  capabilities: { offered: ['live_subscriptions'] },
  provenance: {
    supervisorGeneration: 'generation',
    issuedAt: '2026-08-05T20:00:00.000Z',
    expiresAt: '2026-08-05T21:00:00.000Z',
  },
  integrity: { channel: 'local-supervised-ipc' },
} as const satisfies AppBindingV1;

const boot = createSnapbackExpoBoot({ app, binding, environment });
createSnapbackExpoBoot({ app: generatedApp, binding, environment });
const state: ExpoBootState = boot.getSnapshot();
if (state.status === 'starting') {
  const stage: 'binding' | 'authority' | 'client' = state.stage;
  void stage;
} else if (state.status === 'ready') {
  const source: 'supervised-dev' | 'release' = state.binding.source;
  const kind: 'session' = state.authority.kind;
  void source;
  void kind;
} else {
  const code: string = state.diagnostic.code;
  const remediations = state.remediations;
  void code;
  void remediations;
}
