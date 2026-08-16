import {
  createSnapbackExpoBoot,
  createExpoAssetSourceAdapter,
  useSnapbackActivityPresence,
  type AppBindingV1,
  type AppDescriptorV1Like,
  type ConnectionEphemeralCollectionReference,
  type ExpoBootState,
  type SnapbackExpoEnvironmentV1,
} from './index.mjs';
import type { GeneratedAppDescriptorV1 } from '../../demos/zero-bakeoff/apps/field-notebook/snapback/generated/app.d.ts';

declare const app: AppDescriptorV1Like;
declare const environment: SnapbackExpoEnvironmentV1;
declare const generatedApp: GeneratedAppDescriptorV1;
declare const typing: ConnectionEphemeralCollectionReference<
  'typing',
  { roomId: string },
  { userHandle: string; name: string }
>;

function ActivityFixture() {
  const presence = useSnapbackActivityPresence(typing, {
    scope: { roomId: 'room-one' },
    value: () => ({ userHandle: 'ada', name: 'Ada' }),
    idleMs: 3_000,
  });
  presence.touch();
  void presence.withdraw();
  return presence.peers.length;
}
void ActivityFixture;

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
const hostedDevelopmentBinding = {
  format: 'snapback.app-binding.v1',
  source: 'hosted-development',
  descriptorIdentity: 'sha256:descriptor',
  target: {
    app: 'app',
    schema: 'sha256:schema',
    functions: 'sha256:functions',
    origin: 'https://hosted.example.test',
    routing: 'https',
  },
  capabilities: { offered: ['live_subscriptions'] },
  provenance: { hostedTargetReceipt: 'sha256:hosted-target-receipt' },
  integrity: { channel: 'hosted-target-admission' },
} as const satisfies AppBindingV1;
void hostedDevelopmentBinding;
const pickerAdapter = createExpoAssetSourceAdapter({
  fetch: async () => ({ blob: async () => new Blob(['fixture'], { type: 'image/png' }) }),
});
void pickerAdapter({
  uri: 'content://media/external/images/media/42',
  fileName: 'picked.png',
  mimeType: 'image/png',
});
createSnapbackExpoBoot({ app: generatedApp, binding, environment });
const state: ExpoBootState = boot.getSnapshot();
if (state.status === 'starting') {
  const stage: 'binding' | 'custody' | 'authority' | 'client' = state.stage;
  void stage;
} else if (state.status === 'ready') {
  const source: 'supervised-dev' | 'hosted-development' | 'release' = state.binding.source;
  void source;
  if ('authority' in state) {
    const kind: 'session' = state.authority.kind;
    void kind;
  } else {
    const authoritySource = state.authoritySource;
    const custodyGrade: 'durable' | 'single-runtime' | 'volatile' = state.custody.grade;
    void authoritySource;
    void custodyGrade;
  }
} else {
  const code: string = state.diagnostic.code;
  const remediations = state.remediations;
  void code;
  void remediations;
}
